export interface AgentConfig {
  ensName: string;
  ownerAddress: string;
  recipientAddress: string;
  amountUsdc: string;
  targetRateNgn: number;
}

export interface RateData {
  usdcToNgn: number;
  usdToNgn: number;
  ethToUsdc: number;
  timestamp: number;
  source: string;
}

export interface SwapResult {
  txHash: string;
  amountInEth: string;
  amountOutUsdc: string;
  effectiveRateNgn: number;
  timestamp: number;
  slippage: number;
}

export interface KeeperJob {
  jobId: string;
  status: "pending" | "executing" | "confirmed" | "failed";
  txHash?: string;
  gasUsed?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UniswapQuoteSnapshot {
  source: "uniswap-api" | "uniswap-v3-contract";
  expectedUsdc: string;
  minimumOut: string;
  route: string;
  slippageBps: number;
  priceImpact?: number;
  estimatedGas?: string;
  quoteId?: string;
  quotedAt: string;
}

export interface RemittanceReceipt {
  id: string;
  agentEnsName: string;
  senderAddress: string;
  recipientAddress: string;
  amountUsdc: string;
  amountInEth?: string;
  effectiveRateNgn: number;
  rateSource?: string;
  rateAsOf?: string;
  keeperJobId: string;
  uniswapTxHash: string;
  uniswapRoute?: string;
  uniswapQuoteSource?: UniswapQuoteSnapshot["source"];
  uniswapQuoteBefore?: UniswapQuoteSnapshot;
  uniswapQuoteAfter?: UniswapQuoteSnapshot;
  expectedAmountOutUsdc?: string;
  minimumAmountOutUsdc?: string;
  slippageBps?: number;
  priceImpact?: number;
  executionStatus?: KeeperJob["status"];
  zeroGRootHash?: string;
  zeroGTxHash?: string;
  storageProvider?: "0G" | "memory" | "demo";
  storageError?: string;
  demo?: boolean;
  timestamp: number;
  status: "success" | "failed";
}

export interface AgentEvent {
  type:
    | "job_created"
    | "job_watching"
    | "job_paused"
    | "job_resumed"
    | "job_cancelled"
    | "target_updated"
    | "rate_update"
    | "threshold_hit"
    | "quote_received"
    | "job_submitted"
    | "job_confirmed"
    | "receipt_saved"
    | "ens_updated"
    | "error";
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export type AgentAction = "start" | "stop";

export type AgentState = "idle" | "running" | "stopped";

export interface AgentStatus {
  state: AgentState;
  startedAt?: string;
  stoppedAt?: string;
  message: string;
}

export type AgentJobState =
  | "queued"
  | "registering"
  | "watching"
  | "executing"
  | "keeper_pending"
  | "storing"
  | "paused"
  | "cancelled"
  | "done"
  | "error"
  | "stopped";

export interface AgentMemoryProof {
  eventType: AgentEvent["type"];
  message: string;
  timestamp: number;
  key: string;
  persistedToZeroG: boolean;
  rootHash: string | null;
  txHash: string | null;
  error: string | null;
}

export interface AgentJob {
  id: string;
  config: AgentConfig;
  state: AgentJobState;
  message: string;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  lockedUntil?: number;
  pausedFromState?: AgentJobState;
  lastRate?: RateQuote;
  amountInEth?: string;
  uniswapQuote?: UniswapQuoteSnapshot;
  postExecutionQuote?: UniswapQuoteSnapshot;
  keeperJobId?: string;
  lastKeeperStatus?: KeeperJob["status"];
  zeroGMemoryProofs?: AgentMemoryProof[];
  receipt?: RemittanceReceipt;
  error?: string;
}

export interface RateQuote {
  pair: "USDC/NGN";
  base: "USDC";
  quote: "NGN";
  rate: number;
  inverseRate: number;
  source: string;
  asOf: string;
}

export type ReceiptStatus = "pending" | "confirmed" | "failed";

export interface Receipt {
  id: string;
  wallet?: `0x${string}`;
  txHash?: `0x${string}`;
  amount: string;
  asset: string;
  recipient?: string;
  status: ReceiptStatus;
  createdAt: string;
  storageProvider: "0G";
  metadata?: Record<string, unknown>;
}

export interface PaymentRequest {
  amountNgn: number;
  recipientAddress?: `0x${string}`;
  recipientEns?: string;
  memo?: string;
}

export interface PaymentQuote {
  amountNgn: number;
  usdcAmount: number;
  feeUsdc: number;
  totalUsdc: number;
  rate: RateQuote;
}
