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

export interface RemittanceReceipt {
  id: string;
  agentEnsName: string;
  senderAddress: string;
  recipientAddress: string;
  amountUsdc: string;
  effectiveRateNgn: number;
  keeperJobId: string;
  uniswapTxHash: string;
  timestamp: number;
  status: "success" | "failed";
}

export interface AgentEvent {
  type:
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
