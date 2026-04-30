import { EventEmitter } from "node:events";
import type * as Types from "@/types";
import * as ens from "@/lib/ens";
import * as payments from "@/lib/payments";
import * as rates from "@/lib/rates";
import * as storage from "@/lib/storage";
import * as swap from "@/lib/swap";

export type AgentRuntimeStatus =
  | "idle"
  | "watching"
  | "executing"
  | "done"
  | "error";

let agentStatus: Types.AgentStatus = {
  state: "idle",
  message: "Agent is ready and has not been started.",
};

export class RemittanceAgent extends EventEmitter {
  private config: Types.AgentConfig;
  private rateWatcher: rates.RateWatcher | null = null;
  private isRunning = false;
  private status: AgentRuntimeStatus = "idle";
  private lastRateQuote: Types.RateQuote | null = null;

  constructor(config: Types.AgentConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.status = "watching";

    this.emitAgentEvent({
      type: "rate_update",
      message: "Agent started, watching rates...",
    });

    try {
      const ensName = await ens.registerAgentName(
        getSubname(this.config.ensName),
        this.config.ownerAddress,
        this.config,
      );
      this.config = { ...this.config, ensName };

      this.emitAgentEvent({
        type: "ens_updated",
        message: `ENS agent registered: ${ensName}`,
        data: { ensName },
      });

      this.rateWatcher = rates.watchRate(this.config.targetRateNgn);
      this.rateWatcher.on("rate_update", (rate: Types.RateQuote) => {
        this.lastRateQuote = rate;
        this.emitAgentEvent({
          type: "rate_update",
          message: `Current rate: ${rate.rate} NGN per USDC`,
          data: { rate },
        });
      });
      this.rateWatcher.once("threshold_hit", (rate: Types.RateQuote) => {
        this.lastRateQuote = rate;
        this.stopWatcherOnly();
        void this.executeRemittance();
      });
      this.rateWatcher.on("watcher_error", (error: unknown) => {
        this.fail(error);
      });
    } catch (error) {
      this.fail(error);
    }
  }

  async executeRemittance(): Promise<void> {
    if (!this.isRunning && this.status !== "watching") {
      return;
    }

    this.status = "executing";

    this.emitAgentEvent({
      type: "threshold_hit",
      message: "Target rate reached! Executing swap...",
    });

    try {
      const amountInEth = await this.estimateEthInputForUsdc(
        this.config.amountUsdc,
      );
      const quote = await swap.getSwapQuote(amountInEth);

      this.emitAgentEvent({
        type: "quote_received",
        message: `Quote: ${quote.expectedUsdc} USDC for ${amountInEth} ETH`,
        data: { amountInEth, quote },
      });

      const swapTx = await swap.buildSwapTransaction(
        amountInEth,
        this.config.recipientAddress,
        quote,
      );
      const jobId = await payments.scheduleRemittance(swapTx, {
        agentEnsName: this.config.ensName,
        recipientAddress: this.config.recipientAddress,
        targetRate: this.config.targetRateNgn,
        amountUsdc: this.config.amountUsdc,
      });

      this.emitAgentEvent({
        type: "job_submitted",
        message: `KeeperHub job ${jobId} submitted`,
        data: { jobId },
      });

      const finalJob = await payments.pollJobStatus(jobId, (job) => {
        this.emitJobUpdate(job);
      });

      if (finalJob.status !== "confirmed") {
        throw new Error(`KeeperHub job ${finalJob.jobId} failed`);
      }

      const receipt = this.buildReceipt(finalJob);
      const storageResult = await storage.saveReceipt(receipt);
      const savedReceipt = storageResult.receipt ?? receipt;

      this.emitAgentEvent({
        type: "receipt_saved",
        message: storageResult.persistedToZeroG
          ? "Receipt saved to 0G Storage"
          : "Receipt saved to memory fallback",
        data: { receipt: savedReceipt, storage: storageResult },
      });

      await ens.updateAgentStats(this.config.ensName, savedReceipt);

      this.status = "done";
      this.isRunning = false;
      this.emitAgentEvent({
        type: "ens_updated",
        message: "ENS stats updated",
        data: { ensName: this.config.ensName },
      });
      this.emit("done");
    } catch (error) {
      this.fail(error);
    }
  }

  stop(): void {
    this.stopWatcherOnly();
    this.isRunning = false;
    this.status = "idle";
    this.emit("stopped");
  }

  getStatus(): AgentRuntimeStatus {
    return this.status;
  }

  private emitJobUpdate(job: Types.KeeperJob) {
    if (job.status === "confirmed") {
      this.emitAgentEvent({
        type: "job_confirmed",
        message: `KeeperHub job ${job.jobId} confirmed`,
        data: { job },
      });
      return;
    }

    if (job.status === "failed") {
      this.emitAgentEvent({
        type: "error",
        message: `KeeperHub job ${job.jobId} failed`,
        data: { job },
      });
      return;
    }

    this.emitAgentEvent({
      type: "job_submitted",
      message: `KeeperHub job ${job.jobId} status: ${job.status}`,
      data: { job },
    });
  }

  private async estimateEthInputForUsdc(amountUsdc: string): Promise<string> {
    const sampleEth = 0.001;
    const sampleQuote = await swap.getSwapQuote(sampleEth.toString());
    const expectedUsdc = Number(sampleQuote.expectedUsdc);
    const desiredUsdc = Number(amountUsdc);

    if (!Number.isFinite(expectedUsdc) || expectedUsdc <= 0) {
      throw new Error("Unable to estimate ETH input from quote");
    }

    if (!Number.isFinite(desiredUsdc) || desiredUsdc <= 0) {
      throw new Error("Agent amountUsdc must be a positive number");
    }

    return ((desiredUsdc / expectedUsdc) * sampleEth).toFixed(8);
  }

  private buildReceipt(job: Types.KeeperJob): Types.RemittanceReceipt {
    const timestamp = Date.now();

    return {
      id: `${this.config.ensName}:${timestamp}`,
      agentEnsName: this.config.ensName,
      senderAddress: this.config.ownerAddress,
      recipientAddress: this.config.recipientAddress,
      amountUsdc: this.config.amountUsdc,
      effectiveRateNgn: this.lastRateQuote?.rate ?? this.config.targetRateNgn,
      rateSource: this.lastRateQuote?.source,
      rateAsOf: this.lastRateQuote?.asOf,
      keeperJobId: job.jobId,
      uniswapTxHash: job.txHash ?? "",
      timestamp,
      status: "success",
    };
  }

  private emitAgentEvent(event: Omit<Types.AgentEvent, "timestamp">) {
    this.emit("event", {
      ...event,
      timestamp: Date.now(),
    } satisfies Types.AgentEvent);
  }

  private fail(error: unknown) {
    this.stopWatcherOnly();
    this.isRunning = false;
    this.status = "error";
    this.emitAgentEvent({
      type: "error",
      message: error instanceof Error ? error.message : "Remittance agent failed",
      data: { error },
    });
    this.emit("done");
  }

  private stopWatcherOnly() {
    this.rateWatcher?.stop();
    this.rateWatcher = null;
  }
}

export async function getAgentStatus(): Promise<Types.AgentStatus> {
  return agentStatus;
}

export async function startAgent(): Promise<Types.AgentStatus> {
  const startedAt = new Date().toISOString();

  agentStatus = {
    state: "running",
    startedAt,
    message: "Agent started. Submit an AgentConfig to open the live event stream.",
  };

  return agentStatus;
}

export async function stopAgent(): Promise<Types.AgentStatus> {
  agentStatus = {
    ...agentStatus,
    state: "stopped",
    stoppedAt: new Date().toISOString(),
    message: "Agent stopped.",
  };

  return agentStatus;
}

export async function updateAgent(
  action: Types.AgentAction,
): Promise<Types.AgentStatus> {
  if (action === "start") {
    return startAgent();
  }

  return stopAgent();
}

function getSubname(ensName: string): string {
  return ensName.includes(".") ? ensName.split(".")[0] : ensName;
}
