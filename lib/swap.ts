import { CurrencyAmount, Token, TradeType } from "@uniswap/sdk-core";
import {
  computePoolAddress,
  FeeAmount,
  Pool,
  Route,
  Trade,
} from "@uniswap/v3-sdk";
import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  parseAbiParameters,
  parseEther,
  parseUnits,
  toHex,
  type Address,
  type Hex,
  type TransactionRequest,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { PaymentQuote, SwapResult } from "@/types";
import { getNgnUsdcRate } from "@/lib/rates";

export interface SwapQuote {
  expectedUsdc: string;
  priceImpact: number;
  route: string;
  minimumOut: string;
}

export type SwapTransactionRequest = TransactionRequest & {
  gasLimit: bigint;
};

const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;
const FEE_RATE = 0.005;
const SLIPPAGE_BPS = BigInt(50);
const BPS_DENOMINATOR = BigInt(10_000);
const CHAIN_ID = sepolia.id;

const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const UNISWAP_V3_FACTORY_ADDRESS =
  "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const QUOTER_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const UNIVERSAL_ROUTER_ADDRESS =
  "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";

const COMMAND_V3_SWAP_EXACT_IN = "0x00";
const COMMAND_WRAP_ETH = "0x0b";

const WETH = new Token(
  CHAIN_ID,
  WETH_ADDRESS,
  WETH_DECIMALS,
  "WETH",
  "Wrapped Ether",
);
const USDC = new Token(CHAIN_ID, USDC_ADDRESS, USDC_DECIMALS, "USDC", "USD Coin");

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL),
});

const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const legacyQuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

export async function getSwapQuote(amountInEth: string): Promise<SwapQuote> {
  const amountIn = parsePositiveEth(amountInEth);
  const amountOut = await quoteEthToUsdc(amountIn);
  const minimumOut = applySlippage(amountOut);
  const priceImpact = await calculatePriceImpact(amountIn, amountOut);

  return {
    expectedUsdc: formatUnits(amountOut, USDC_DECIMALS),
    priceImpact,
    route: "ETH -> WETH -> USDC via Uniswap v3 0.30% on Sepolia",
    minimumOut: formatUnits(minimumOut, USDC_DECIMALS),
  };
}

export async function buildSwapTransaction(
  amountInEth: string,
  recipientAddress: string,
  quote: SwapQuote,
): Promise<SwapTransactionRequest> {
  const recipient = assertAddress(recipientAddress, "recipientAddress");
  const account = getWalletAccount();
  const amountIn = parsePositiveEth(amountInEth);
  const minimumOut = parseUnits(quote.minimumOut, USDC_DECIMALS);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const path = encodeV3Path([WETH_ADDRESS, USDC_ADDRESS], [FeeAmount.MEDIUM]);

  const commands = concat([COMMAND_WRAP_ETH, COMMAND_V3_SWAP_EXACT_IN]);
  const inputs = [
    encodeAbiParameters(parseAbiParameters("address recipient,uint256 amountMin"), [
      UNIVERSAL_ROUTER_ADDRESS,
      amountIn,
    ]),
    encodeAbiParameters(
      parseAbiParameters(
        "address recipient,uint256 amountIn,uint256 amountOutMinimum,bytes path,bool payerIsUser",
      ),
      [recipient, amountIn, minimumOut, path, false],
    ),
  ];

  const data = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [commands, inputs, deadline],
  });

  try {
    const gas = await publicClient.estimateGas({
      account,
      to: UNIVERSAL_ROUTER_ADDRESS,
      data,
      value: amountIn,
    });
    const gasLimit = applyGasBuffer(gas);

    return {
      to: UNIVERSAL_ROUTER_ADDRESS,
      data,
      value: amountIn,
      gas: gasLimit,
      gasLimit,
    };
  } catch (error) {
    throw normalizeSwapError(error);
  }
}

export async function executeSwap(
  amountInEth: string,
  recipientAddress: string,
): Promise<SwapResult> {
  try {
    const account = getWalletAccount();
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL),
    });
    const amountIn = parsePositiveEth(amountInEth);
    const balance = await publicClient.getBalance({ address: account.address });

    if (balance < amountIn) {
      throw new InsufficientBalanceError(
        `Insufficient balance: ${formatEther(balance)} ETH available, ${amountInEth} ETH required before gas.`,
      );
    }

    const quote = await getSwapQuote(amountInEth);
    const transaction = await buildSwapTransaction(
      amountInEth,
      recipientAddress,
      quote,
    );
    const hash = await walletClient.sendTransaction({
      account,
      chain: sepolia,
      to: transaction.to as Address,
      data: transaction.data as Hex,
      value: transaction.value,
      gas: transaction.gas ?? transaction.gasLimit,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      throw new TransactionRevertedError(`Swap transaction reverted: ${hash}`);
    }

    const ngnRate = await getNgnUsdcRate();

    return {
      txHash: hash,
      amountInEth,
      amountOutUsdc: quote.expectedUsdc,
      effectiveRateNgn: ngnRate.rate,
      timestamp: Math.floor(Date.now() / 1000),
      slippage: Number(SLIPPAGE_BPS) / 100,
    };
  } catch (error) {
    throw normalizeSwapError(error);
  }
}

export async function quoteNgnToUsdc(amountNgn: number): Promise<PaymentQuote> {
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    throw new Error("amountNgn must be a positive number");
  }

  const rate = await getNgnUsdcRate();
  const usdcAmount = amountNgn / rate.rate;
  const feeUsdc = Math.max(usdcAmount * FEE_RATE, 0.01);

  return {
    amountNgn,
    usdcAmount,
    feeUsdc,
    totalUsdc: usdcAmount + feeUsdc,
    rate,
  };
}

export function toUsdcUnits(amount: number): bigint {
  return parseUnits(amount.toFixed(USDC_DECIMALS), USDC_DECIMALS);
}

export function fromUsdcUnits(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

async function quoteEthToUsdc(amountIn: bigint): Promise<bigint> {
  try {
    const [amountOut] = await publicClient.readContract({
      address: QUOTER_ADDRESS,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: WETH_ADDRESS,
          tokenOut: USDC_ADDRESS,
          amountIn,
          fee: FeeAmount.MEDIUM,
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });

    return amountOut;
  } catch {
    return publicClient.readContract({
      address: QUOTER_ADDRESS,
      abi: legacyQuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [WETH_ADDRESS, USDC_ADDRESS, FeeAmount.MEDIUM, amountIn, BigInt(0)],
    });
  }
}

async function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
): Promise<number> {
  const poolAddress = computePoolAddress({
    factoryAddress: UNISWAP_V3_FACTORY_ADDRESS,
    tokenA: WETH,
    tokenB: USDC,
    fee: FeeAmount.MEDIUM,
  }) as Address;

  const [slot0, liquidity] = await Promise.all([
    publicClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "slot0",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "liquidity",
    }),
  ]);
  const [sqrtPriceX96, tick] = slot0;
  const pool = new Pool(
    WETH,
    USDC,
    FeeAmount.MEDIUM,
    sqrtPriceX96.toString(),
    liquidity.toString(),
    tick,
  );
  const route = new Route([pool], WETH, USDC);
  const trade = Trade.createUncheckedTrade({
    route,
    inputAmount: CurrencyAmount.fromRawAmount(WETH, amountIn.toString()),
    outputAmount: CurrencyAmount.fromRawAmount(USDC, amountOut.toString()),
    tradeType: TradeType.EXACT_INPUT,
  });

  return Number(trade.priceImpact.toFixed(4));
}

function encodeV3Path(tokens: readonly [Address, Address], fees: readonly [number]) {
  return concat([tokens[0], toHex(fees[0], { size: 3 }), tokens[1]]);
}

function applySlippage(amountOut: bigint): bigint {
  return (amountOut * (BPS_DENOMINATOR - SLIPPAGE_BPS)) / BPS_DENOMINATOR;
}

function applyGasBuffer(gas: bigint): bigint {
  return (gas * BigInt(120)) / BigInt(100);
}

function parsePositiveEth(amountInEth: string): bigint {
  const amountIn = parseEther(amountInEth);

  if (amountIn <= BigInt(0)) {
    throw new Error("amountInEth must be greater than zero");
  }

  return amountIn;
}

function assertAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be a valid Ethereum address`);
  }

  return value;
}

function getWalletAccount() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required to execute swaps");
  }

  return privateKeyToAccount(
    privateKey.startsWith("0x") ? (privateKey as Hex) : (`0x${privateKey}` as Hex),
  );
}

function normalizeSwapError(error: unknown): Error {
  if (
    error instanceof InsufficientBalanceError ||
    error instanceof SlippageExceededError ||
    error instanceof TransactionRevertedError
  ) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("insufficient funds") ||
    normalized.includes("insufficient balance") ||
    normalized.includes("exceeds the balance")
  ) {
    return new InsufficientBalanceError(message);
  }

  if (
    normalized.includes("too little received") ||
    normalized.includes("v3toolittlereceived") ||
    normalized.includes("slippage") ||
    normalized.includes("amountoutminimum")
  ) {
    return new SlippageExceededError(message);
  }

  if (
    normalized.includes("execution reverted") ||
    normalized.includes("transaction reverted") ||
    normalized.includes("reverted")
  ) {
    return new TransactionRevertedError(message);
  }

  return error instanceof Error ? error : new Error(message);
}

class InsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

class SlippageExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlippageExceededError";
  }
}

class TransactionRevertedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionRevertedError";
  }
}
