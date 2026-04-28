import { ethers } from "ethers";
import type { TransactionRequest } from "viem";
import type { KeeperJob, PaymentQuote, PaymentRequest } from "@/types";
import { resolveEnsName } from "@/lib/ens";
import { quoteNgnToUsdc, toUsdcUnits } from "@/lib/swap";

export interface PreparedPayment {
  to: `0x${string}`;
  quote: PaymentQuote;
  amountUnits: string;
  receiptId: string;
  memo?: string;
}

export async function preparePayment(
  request: PaymentRequest,
): Promise<PreparedPayment> {
  const recipient = await resolveRecipient(request);
  const quote = await quoteNgnToUsdc(request.amountNgn);
  const amountUnits = toUsdcUnits(quote.totalUsdc).toString();

  return {
    to: recipient,
    quote,
    amountUnits,
    receiptId: ethers.id(
      `${recipient}:${amountUnits}:${request.memo ?? ""}:${Date.now()}`,
    ),
    memo: request.memo,
  };
}

async function resolveRecipient(request: PaymentRequest): Promise<`0x${string}`> {
  if (request.recipientAddress && ethers.isAddress(request.recipientAddress)) {
    return request.recipientAddress;
  }

  if (request.recipientEns) {
    const resolved = await resolveEnsName(request.recipientEns);

    if (resolved) {
      return resolved;
    }
  }

  throw new Error("Provide a valid recipientAddress or resolvable recipientEns");
}

export async function scheduleRemittance(
  swapTx: TransactionRequest,
  meta: {
    agentEnsName: string;
    recipientAddress: string;
    targetRate: number;
    amountUsdc: string;
  },
): Promise<string> {
  const payload = await keeperHubRequest<unknown>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      transaction: serializeTransactionRequest(swapTx),
      retry_attempts: 3,
      priority: "high",
      gas_optimization: true,
      metadata: meta,
    }),
  });
  const job = unwrapKeeperHubPayload(payload);

  if (!isRecord(job)) {
    throw new Error("KeeperHub did not return a job object");
  }

  const jobId = readString(job, "jobId") ?? readString(job, "id");

  if (!jobId) {
    throw new Error("KeeperHub did not return a jobId");
  }

  return jobId;
}

export async function pollJobStatus(
  jobId: string,
  onUpdate: (job: KeeperJob) => void,
): Promise<KeeperJob> {
  const startedAt = Date.now();
  const timeoutMs = 5 * 60 * 1000;
  let lastStatus: KeeperJob["status"] | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await keeperHubRequest<unknown>(`/jobs/${jobId}`);
    const job = normalizeKeeperJob(unwrapKeeperHubPayload(payload));

    if (job.status !== lastStatus) {
      onUpdate(job);
      lastStatus = job.status;
    }

    if (job.status === "confirmed" || job.status === "failed") {
      return job;
    }

    await delay(8000);
  }

  throw new Error(`KeeperHub job ${jobId} timed out after 5 minutes`);
}

export async function getJobHistory(agentEnsName: string): Promise<KeeperJob[]> {
  const params = new URLSearchParams({
    "metadata.agentEnsName": agentEnsName,
  });
  const payload = await keeperHubRequest<unknown>(`/jobs?${params.toString()}`);
  const data = unwrapKeeperHubPayload(payload);
  const jobs = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.jobs)
      ? data.jobs
      : [];

  return jobs.filter(isRecord).map(normalizeKeeperJob);
}

async function keeperHubRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiKey = process.env.KEEPERHUB_API_KEY;

  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required for KeeperHub requests");
  }

  const baseUrl = process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api";
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "X-API-Key": apiKey,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `KeeperHub request failed with ${response.status}: ${errorBody}`,
    );
  }

  return (await response.json()) as T;
}

function serializeTransactionRequest(swapTx: TransactionRequest) {
  return Object.fromEntries(
    Object.entries(swapTx)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "bigint" ? value.toString() : value,
      ]),
  );
}

function normalizeKeeperJob(value: unknown): KeeperJob {
  if (!isRecord(value)) {
    throw new Error("KeeperHub returned an invalid job payload");
  }

  const now = Date.now();

  return {
    jobId: readString(value, "jobId") ?? readString(value, "id") ?? "",
    status: normalizeKeeperStatus(readString(value, "status")),
    txHash: readString(value, "txHash") ?? readString(value, "transactionHash"),
    gasUsed: readString(value, "gasUsed") ?? readString(value, "gasUsedWei"),
    createdAt: readTimestamp(value.createdAt) ?? now,
    updatedAt: readTimestamp(value.updatedAt) ?? readTimestamp(value.completedAt) ?? now,
  };
}

function normalizeKeeperStatus(status?: string): KeeperJob["status"] {
  if (status === "pending" || status === "executing" || status === "failed") {
    return status;
  }

  if (status === "confirmed" || status === "completed") {
    return "confirmed";
  }

  if (status === "running") {
    return "executing";
  }

  return "pending";
}

function unwrapKeeperHubPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  return payload.data ?? payload.job ?? payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];

  return typeof value === "string" ? value : undefined;
}

function readTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
