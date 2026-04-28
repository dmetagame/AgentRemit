import {
  createEnsPublicClient,
  createEnsWalletClient,
} from "@ensdomains/ensjs";
import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { AgentConfig, RemittanceReceipt } from "@/types";

const AGENT_ROOT_NAME = "agentremit.eth";
const SEPOLIA_PUBLIC_RESOLVER_ADDRESS =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const AGENT_TEXT_RECORD_KEYS = [
  "purpose",
  "owner",
  "recipient",
  "target_rate",
  "amount_usdc",
  "created_at",
  "total_sent",
  "tx_count",
  "last_active",
] as const;

export interface AgentStatsOverwrite {
  totalSent: string;
  txCount: number;
  lastActive: string;
}

const ensPublicClient = createEnsPublicClient({
  chain: sepolia,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL),
});

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL),
});

export async function registerAgentName(
  subname: string,
  ownerAddress: string,
  config: AgentConfig,
): Promise<string> {
  const label = normalizeSubname(subname);
  const fullName = `${label}.${AGENT_ROOT_NAME}`;
  const owner = assertAddress(ownerAddress, "ownerAddress");
  const recipient = assertAddress(config.recipientAddress, "recipientAddress");
  const wallet = getEnsWalletClient();
  const createdAt = new Date().toISOString();

  await waitForHash(
    await wallet.createSubname({
      name: fullName,
      owner,
      contract: "registry",
      resolverAddress: SEPOLIA_PUBLIC_RESOLVER_ADDRESS,
    }),
  );

  const records = {
    purpose: "Autonomous remittance agent — Lagos corridor",
    owner,
    recipient,
    target_rate: config.targetRateNgn.toString(),
    amount_usdc: config.amountUsdc,
    created_at: createdAt,
    total_sent: "0",
    tx_count: "0",
    last_active: "never",
  };

  await setTextRecords(fullName, records);

  return fullName;
}

export async function getAgentProfile(
  ensName: string,
): Promise<AgentConfig & { totalSent: string; txCount: number; lastActive: string }> {
  const records = await readAgentTextRecords(ensName);
  const ownerAddress = requireText(records, "owner", ensName);
  const recipientAddress = requireText(records, "recipient", ensName);
  const amountUsdc = requireText(records, "amount_usdc", ensName);
  const targetRate = Number(requireText(records, "target_rate", ensName));

  if (!Number.isFinite(targetRate)) {
    throw new Error(`ENS name ${ensName} has an invalid target_rate text record`);
  }

  return {
    ensName,
    ownerAddress,
    recipientAddress,
    amountUsdc,
    targetRateNgn: targetRate,
    totalSent: records.total_sent ?? "0",
    txCount: parseInteger(records.tx_count ?? "0"),
    lastActive: records.last_active ?? "never",
  };
}

export async function updateAgentStats(
  ensName: string,
  receiptOrStats: RemittanceReceipt | AgentStatsOverwrite,
): Promise<void> {
  if (isStatsOverwrite(receiptOrStats)) {
    await setTextRecords(ensName, {
      total_sent: receiptOrStats.totalSent,
      tx_count: receiptOrStats.txCount.toString(),
      last_active: receiptOrStats.lastActive,
    });
    return;
  }

  const records = await readAgentTextRecords(ensName);
  const totalSent = addDecimalStrings(
    records.total_sent ?? "0",
    receiptOrStats.amountUsdc,
  );
  const txCount = parseInteger(records.tx_count ?? "0") + 1;
  const lastActive = toIsoTimestamp(receiptOrStats.timestamp);

  await setTextRecords(ensName, {
    total_sent: totalSent,
    tx_count: txCount.toString(),
    last_active: lastActive,
  });
}

function isStatsOverwrite(
  value: RemittanceReceipt | AgentStatsOverwrite,
): value is AgentStatsOverwrite {
  return "totalSent" in value && "txCount" in value && "lastActive" in value;
}

export function generateAgentName(recipientName: string): string {
  const label = recipientName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `sends-${label || "recipient"}-home`;
}

export async function resolveEnsName(
  nameOrAddress: string,
): Promise<Address | null> {
  if (isAddress(nameOrAddress)) {
    return nameOrAddress;
  }

  if (!nameOrAddress.endsWith(".eth")) {
    return null;
  }

  const record = await ensPublicClient.getAddressRecord({
    name: nameOrAddress,
    coin: "ETH",
  });

  return record?.value && isAddress(record.value)
    ? (record.value as Address)
    : null;
}

export async function lookupEnsAddress(address: Address): Promise<string | null> {
  const record = await ensPublicClient.getName({
    address,
    allowMismatch: false,
  });

  return record?.name ?? null;
}

function getEnsWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required for ENS write operations");
  }

  const account = privateKeyToAccount(normalizePrivateKey(privateKey));

  return createEnsWalletClient({
    account,
    chain: sepolia,
    transport: http(process.env.NEXT_PUBLIC_ALCHEMY_SEPOLIA_URL),
  });
}

async function readAgentTextRecords(
  ensName: string,
): Promise<Partial<Record<(typeof AGENT_TEXT_RECORD_KEYS)[number], string>>> {
  const records = await ensPublicClient.getRecords({
    name: ensName,
    texts: AGENT_TEXT_RECORD_KEYS,
    contentHash: false,
    abi: false,
  });

  return Object.fromEntries(
    records.texts.map((record) => [record.key, record.value]),
  );
}

async function setTextRecords(
  ensName: string,
  records: Record<string, string>,
): Promise<void> {
  const wallet = getEnsWalletClient();

  for (const [key, value] of Object.entries(records)) {
    await waitForHash(
      await wallet.setTextRecord({
        name: ensName,
        key,
        value,
        resolverAddress: SEPOLIA_PUBLIC_RESOLVER_ADDRESS,
      }),
    );
  }
}

async function waitForHash(hash: Hash) {
  await publicClient.waitForTransactionReceipt({ hash });
}

function normalizeSubname(subname: string): string {
  const label = subname.includes(".") ? subname.split(".")[0] : subname;
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error("subname must contain at least one alphanumeric character");
  }

  return normalized;
}

function assertAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be a valid Ethereum address`);
  }

  return value;
}

function requireText(
  records: Partial<Record<(typeof AGENT_TEXT_RECORD_KEYS)[number], string>>,
  key: (typeof AGENT_TEXT_RECORD_KEYS)[number],
  ensName: string,
): string {
  const value = records[key];

  if (!value) {
    throw new Error(`ENS name ${ensName} is missing required ${key} text record`);
  }

  return value;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function addDecimalStrings(left: string, right: string): string {
  const leftParts = parseDecimalString(left);
  const rightParts = parseDecimalString(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftUnits = leftParts.units * powerOfTen(scale - leftParts.scale);
  const rightUnits = rightParts.units * powerOfTen(scale - rightParts.scale);

  return formatDecimalUnits(leftUnits + rightUnits, scale);
}

function powerOfTen(exponent: number): bigint {
  let value = BigInt(1);

  for (let index = 0; index < exponent; index += 1) {
    value *= BigInt(10);
  }

  return value;
}

function parseDecimalString(value: string): { units: bigint; scale: number } {
  const trimmed = value.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fractional = ""] = trimmed.split(".");

  return {
    units: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
}

function formatDecimalUnits(units: bigint, scale: number): string {
  if (scale === 0) {
    return units.toString();
  }

  const padded = units.toString().padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fractional = padded.slice(-scale).replace(/0+$/g, "");

  return fractional ? `${whole}.${fractional}` : whole;
}

function toIsoTimestamp(timestamp: number): string {
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(milliseconds);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function normalizePrivateKey(privateKey: string): Hex {
  return privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
}
