import type { AgentJob, KeeperJob, RateQuote, RemittanceReceipt } from "@/types";
import {
  appendAgentJobEvent,
  getAgentJob,
  listDueAgentJobs,
  recordAgentJobEvent,
  removeActiveAgentJob,
  saveAgentReceipt,
  saveAgentJob,
} from "@/lib/agent-job-store";
import * as payments from "@/lib/payments";
import * as rates from "@/lib/rates";
import * as storage from "@/lib/storage";
import * as swap from "@/lib/swap";

const WATCH_INTERVAL_MS = 30_000;
const KEEPER_POLL_INTERVAL_MS = 8_000;
const JOB_LOCK_MS = 2 * 60 * 1000;

export async function processDueAgentJobs(limit = 5): Promise<{
  processed: number;
}> {
  const jobs = await listDueAgentJobs(limit);
  let processed = 0;

  for (const job of jobs) {
    const didProcess = await processAgentJob(job.id);

    if (didProcess) {
      processed += 1;
    }
  }

  return { processed };
}

export async function processAgentJob(jobId: string): Promise<boolean> {
  const job = await getAgentJob(jobId);

  if (!job || !isActiveState(job.state) || isLocked(job)) {
    return false;
  }

  await saveAgentJob({
    ...job,
    lockedUntil: Date.now() + JOB_LOCK_MS,
  });

  try {
    await processUnlockedJob({
      ...job,
      lockedUntil: Date.now() + JOB_LOCK_MS,
    });
    return true;
  } catch (error) {
    await failJob(job, error);
    return true;
  }
}

async function processUnlockedJob(job: AgentJob): Promise<void> {
  if (job.state === "queued" || job.state === "registering") {
    await initializeAgentMemory(job);
    return;
  }

  if (job.state === "watching") {
    await checkRate(job);
    return;
  }

  if (job.state === "executing") {
    await submitKeeperJob(job);
    return;
  }

  if (job.state === "keeper_pending") {
    await checkKeeperJob(job);
    return;
  }

  if (job.state === "storing") {
    await storeReceiptAndFinish(job);
  }
}

async function initializeAgentMemory(job: AgentJob): Promise<void> {
  const initializingJob = {
    ...job,
    state: "registering",
    message: "Initializing 0G agent memory.",
  } as const;

  await saveAgentJob(initializingJob);

  const nextJob = {
    ...initializingJob,
    state: "watching" as const,
    message: "0G memory initialized. Agent is watching rates.",
    nextRunAt: Date.now(),
    lockedUntil: undefined,
  };

  await saveAgentJob(nextJob);
  await recordAgentJobEvent(nextJob, {
    type: "job_watching",
    message: "Agent initialized 0G memory and started watching rates.",
    data: {
      agentHandle: nextJob.config.ensName,
      targetRateNgn: nextJob.config.targetRateNgn,
    },
    timestamp: Date.now(),
  });
}

async function checkRate(job: AgentJob): Promise<void> {
  const rate = await rates.getNgnUsdcRate();

  await appendAgentJobEvent(job.id, {
    type: "rate_update",
    message: `Current rate: ${rate.rate} NGN per USDC`,
    data: { rate },
    timestamp: Date.now(),
  });

  if (!rates.isExecutableRate(rate)) {
    await saveAgentJob({
      ...job,
      lastRate: rate,
      message: "Live rate unavailable; waiting for a live rate before execution.",
      nextRunAt: Date.now() + WATCH_INTERVAL_MS,
      lockedUntil: undefined,
    });
    return;
  }

  if (rate.rate < job.config.targetRateNgn) {
    await saveAgentJob({
      ...job,
      lastRate: rate,
      message: "Watching rates.",
      nextRunAt: Date.now() + WATCH_INTERVAL_MS,
      lockedUntil: undefined,
    });
    return;
  }

  const nextJob = {
    ...job,
    lastRate: rate,
    state: "executing" as const,
    message: "Target reached. Preparing swap and KeeperHub job.",
    nextRunAt: Date.now(),
    lockedUntil: undefined,
  };

  await saveAgentJob(nextJob);
  await recordAgentJobEvent(nextJob, {
    type: "threshold_hit",
    message: "Target rate reached! Preparing execution...",
    data: { rate },
    timestamp: Date.now(),
  });
}

async function submitKeeperJob(job: AgentJob): Promise<void> {
  const amountInEth = await estimateEthInputForUsdc(
    job.config.amountUsdc,
    job.config.ownerAddress,
  );
  const quote = await swap.getSwapQuote(amountInEth, {
    swapper: job.config.ownerAddress,
  });
  const quotedJob = {
    ...job,
    amountInEth,
    uniswapQuote: quote,
    message: "Uniswap quote received. Preparing KeeperHub execution.",
  };

  await saveAgentJob(quotedJob);
  await recordAgentJobEvent(quotedJob, {
    type: "quote_received",
    message: `Quote: ${quote.expectedUsdc} USDC for ${amountInEth} ETH`,
    data: { amountInEth, quote, source: quote.source },
    timestamp: Date.now(),
  });
  const persistedQuotedJob = (await getAgentJob(job.id)) ?? quotedJob;

  const swapTx = await swap.buildSwapTransaction(
    amountInEth,
    job.config.recipientAddress,
    quote,
  );
  const keeperJobId = await payments.scheduleRemittance(swapTx, {
    agentEnsName: job.config.ensName,
    ownerAddress: job.config.ownerAddress,
    recipientAddress: job.config.recipientAddress,
    targetRate: job.config.targetRateNgn,
    amountUsdc: job.config.amountUsdc,
  });

  const nextJob = {
    ...persistedQuotedJob,
    keeperJobId,
    state: "keeper_pending",
    message: "KeeperHub job submitted; waiting for confirmation.",
    nextRunAt: Date.now() + KEEPER_POLL_INTERVAL_MS,
    lockedUntil: undefined,
  } as const;

  await saveAgentJob(nextJob);
  await recordAgentJobEvent(nextJob, {
    type: "job_submitted",
    message: `KeeperHub job ${keeperJobId} submitted`,
    data: { jobId: keeperJobId, quote, amountInEth },
    timestamp: Date.now(),
  });
}

async function checkKeeperJob(job: AgentJob): Promise<void> {
  if (!job.keeperJobId) {
    throw new Error("Agent job is missing keeperJobId.");
  }

  const keeperJob = await payments.getRemittanceJobStatus(job.keeperJobId);

  if (
    keeperJob.status !== job.lastKeeperStatus &&
    keeperJob.status !== "confirmed"
  ) {
    await appendKeeperEvent(job.id, keeperJob);
  }

  if (keeperJob.status === "failed") {
    throw new Error(`KeeperHub job ${keeperJob.jobId} failed`);
  }

  if (keeperJob.status !== "confirmed") {
    await saveAgentJob({
      ...job,
      lastKeeperStatus: keeperJob.status,
      message: `KeeperHub job status: ${keeperJob.status}.`,
      nextRunAt: Date.now() + KEEPER_POLL_INTERVAL_MS,
      lockedUntil: undefined,
    });
    return;
  }

  const postExecutionQuote = job.amountInEth
    ? await swap.getSwapQuote(job.amountInEth, {
        swapper: job.config.ownerAddress,
      })
    : undefined;
  const nextJob = {
    ...job,
    lastKeeperStatus: keeperJob.status,
    postExecutionQuote,
    receipt: buildReceipt(
      { ...job, postExecutionQuote },
      keeperJob,
      job.lastRate,
    ),
    state: "storing",
    message: "KeeperHub confirmed. Saving receipt.",
    nextRunAt: Date.now(),
    lockedUntil: undefined,
  } as const;

  await saveAgentJob(nextJob);
  await recordAgentJobEvent(nextJob, {
    type: "job_confirmed",
    message: `KeeperHub job ${keeperJob.jobId} confirmed`,
    data: { job: keeperJob, postExecutionQuote },
    timestamp: Date.now(),
  });
}

async function storeReceiptAndFinish(job: AgentJob): Promise<void> {
  if (!job.receipt) {
    throw new Error("Agent job is missing receipt.");
  }

  const storageResult = await storage.saveReceipt(job.receipt);
  const savedReceipt = storageResult.receipt ?? job.receipt;
  await saveAgentReceipt(savedReceipt);

  const nextJob = {
    ...job,
    receipt: savedReceipt,
    state: "done",
    message: "Agent job completed.",
    nextRunAt: Number.MAX_SAFE_INTEGER,
    lockedUntil: undefined,
  } as const;

  await saveAgentJob(nextJob);
  await recordAgentJobEvent(nextJob, {
    type: "receipt_saved",
    message: storageResult.persistedToZeroG
      ? "Receipt and final state saved to 0G."
      : "Receipt saved with memory fallback; 0G write did not confirm.",
    data: { receipt: savedReceipt, storage: storageResult },
    timestamp: Date.now(),
  });
  await removeActiveAgentJob(job.id);
}

async function appendKeeperEvent(jobId: string, job: KeeperJob): Promise<void> {
  if (job.status === "confirmed") {
    await appendAgentJobEvent(jobId, {
      type: "job_confirmed",
      message: `KeeperHub job ${job.jobId} confirmed`,
      data: { job },
      timestamp: Date.now(),
    });
    return;
  }

  await appendAgentJobEvent(jobId, {
    type: "job_submitted",
    message: `KeeperHub job ${job.jobId} status: ${job.status}`,
    data: { job },
    timestamp: Date.now(),
  });
}

async function failJob(job: AgentJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Agent job failed.";
  const nextJob = {
    ...job,
    state: "error",
    message,
    error: message,
    nextRunAt: Number.MAX_SAFE_INTEGER,
    lockedUntil: undefined,
  } as const;

  await saveAgentJob(nextJob);
  await recordAgentJobEvent(nextJob, {
    type: "error",
    message,
    data: { error },
    timestamp: Date.now(),
  });
  await removeActiveAgentJob(job.id);
}

async function estimateEthInputForUsdc(
  amountUsdc: string,
  swapper: string,
): Promise<string> {
  const sampleEth = 0.001;
  const sampleQuote = await swap.getSwapQuote(sampleEth.toString(), { swapper });
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

function buildReceipt(
  job: AgentJob,
  keeperJob: KeeperJob,
  rate: RateQuote | undefined,
): RemittanceReceipt {
  const timestamp = Date.now();

  return {
    id: `${job.config.ensName}:${timestamp}`,
    agentEnsName: job.config.ensName,
    senderAddress: job.config.ownerAddress,
    recipientAddress: job.config.recipientAddress,
    amountUsdc: job.config.amountUsdc,
    amountInEth: job.amountInEth,
    effectiveRateNgn: rate?.rate ?? job.config.targetRateNgn,
    rateSource: rate?.source,
    rateAsOf: rate?.asOf,
    keeperJobId: keeperJob.jobId,
    uniswapTxHash: keeperJob.txHash ?? "",
    uniswapRoute: job.uniswapQuote?.route,
    uniswapQuoteSource: job.uniswapQuote?.source,
    uniswapQuoteBefore: job.uniswapQuote,
    uniswapQuoteAfter: job.postExecutionQuote,
    expectedAmountOutUsdc: job.uniswapQuote?.expectedUsdc,
    minimumAmountOutUsdc: job.uniswapQuote?.minimumOut,
    slippageBps: job.uniswapQuote?.slippageBps,
    priceImpact: job.uniswapQuote?.priceImpact,
    executionStatus: keeperJob.status,
    timestamp,
    status: "success",
  };
}

function isActiveState(state: AgentJob["state"]): boolean {
  return (
    state === "queued" ||
    state === "registering" ||
    state === "watching" ||
    state === "executing" ||
    state === "keeper_pending" ||
    state === "storing"
  );
}

function isLocked(job: AgentJob): boolean {
  return typeof job.lockedUntil === "number" && job.lockedUntil > Date.now();
}
