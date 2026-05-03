import { ethers } from "ethers";
import type { TransactionRequest } from "viem";
import type { KeeperJob, PaymentQuote, PaymentRequest } from "@/types";
import { resolveEnsName } from "@/lib/ens";
import {
  assertRemittanceExecutionAllowed,
  isMockKeeperHubMode,
} from "@/lib/execution-policy";
import { quoteNgnToUsdc, toUsdcUnits } from "@/lib/swap";
import type { KeeperHubContractCall } from "@/lib/swap";

export interface PreparedPayment {
  to: `0x${string}`;
  quote: PaymentQuote;
  amountUnits: string;
  receiptId: string;
  memo?: string;
}

type RemittanceMeta = {
  agentEnsName: string;
  ownerAddress: string;
  recipientAddress: string;
  targetRate: number;
  amountUsdc: string;
};

type MockKeeperJobRecord = KeeperJob & {
  meta: RemittanceMeta;
};

const mockKeeperJobs = new Map<string, MockKeeperJobRecord>();

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
  meta: RemittanceMeta,
): Promise<string> {
  if (shouldUseMockKeeperHub()) {
    return createMockKeeperJob(meta);
  }

  assertRemittanceExecutionAllowed(meta);

  const contractCall = getKeeperHubContractCall(swapTx);
  const payload = await keeperHubRequest<unknown>("/execute/contract-call", {
    method: "POST",
    body: JSON.stringify({
      contractAddress: contractCall.contractAddress,
      network: process.env.KEEPERHUB_NETWORK ?? contractCall.network,
      functionName: contractCall.functionName,
      functionArgs: JSON.stringify(contractCall.functionArgs),
      abi: JSON.stringify(contractCall.abi),
      value: contractCall.value,
      gasLimitMultiplier: contractCall.gasLimitMultiplier,
    }),
  });
  const job = unwrapKeeperHubPayload(payload);

  if (!isRecord(job)) {
    throw new Error("KeeperHub did not return a job object");
  }

  const jobId =
    readString(job, "executionId") ??
    readString(job, "jobId") ??
    readString(job, "id");

  if (!jobId) {
    throw new Error("KeeperHub did not return an executionId");
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
    const job = await getRemittanceJobStatus(jobId);

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

export async function getRemittanceJobStatus(jobId: string): Promise<KeeperJob> {
  const mockJob = mockKeeperJobs.get(jobId);

  if (mockJob) {
    if (mockJob.status === "pending") {
      const executing = {
        ...mockJob,
        status: "executing" as const,
        updatedAt: Date.now(),
      };
      mockKeeperJobs.set(jobId, executing);
      return executing;
    }

    if (mockJob.status === "executing") {
      const confirmed = {
        ...mockJob,
        status: "confirmed" as const,
        txHash: makeMockTransactionHash(jobId),
        updatedAt: Date.now(),
      };
      mockKeeperJobs.set(jobId, confirmed);
      return confirmed;
    }

    return mockJob;
  }

  const payload = await keeperHubRequest<unknown>(
    `/execute/${encodeURIComponent(jobId)}/status`,
  );

  return normalizeKeeperJob(unwrapKeeperHubPayload(payload), jobId);
}

export async function getJobHistory(agentEnsName: string): Promise<KeeperJob[]> {
  return Array.from(mockKeeperJobs.values())
    .filter((job) => job.meta.agentEnsName === agentEnsName)
    .map((job) => ({
      jobId: job.jobId,
      status: job.status,
      txHash: job.txHash,
      gasUsed: job.gasUsed,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
}

async function keeperHubRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiKey = process.env.KEEPERHUB_API_KEY;

  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required for KeeperHub requests");
  }

  const baseUrl = normalizeBaseUrl(
    process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api",
  );
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(formatKeeperHubError(response, path, errorBody));
  }

  return (await response.json()) as T;
}

function getKeeperHubContractCall(
  swapTx: TransactionRequest,
): KeeperHubContractCall {
  const contractCall = (swapTx as TransactionRequest & {
    keeperHubCall?: KeeperHubContractCall;
  }).keeperHubCall;

  if (!contractCall) {
    throw new Error("Swap transaction is missing KeeperHub contract-call data");
  }

  return contractCall;
}

function normalizeKeeperJob(value: unknown, fallbackJobId = ""): KeeperJob {
  if (!isRecord(value)) {
    throw new Error("KeeperHub returned an invalid job payload");
  }

  const now = Date.now();

  return {
    jobId:
      readString(value, "jobId") ??
      readString(value, "executionId") ??
      readString(value, "id") ??
      fallbackJobId,
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

  if (
    status === "confirmed" ||
    status === "completed" ||
    status === "success"
  ) {
    return "confirmed";
  }

  if (status === "running") {
    return "executing";
  }

  if (status === "error" || status === "cancelled") {
    return "failed";
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

function shouldUseMockKeeperHub(): boolean {
  if (isMockKeeperHubMode()) {
    return true;
  }

  return !process.env.KEEPERHUB_API_KEY && process.env.NODE_ENV === "development";
}

function createMockKeeperJob(meta: RemittanceMeta): string {
  const now = Date.now();
  const jobId = `kh_dev_${now.toString(36)}`;

  mockKeeperJobs.set(jobId, {
    jobId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    meta,
  });

  return jobId;
}

function makeMockTransactionHash(jobId: string): `0x${string}` {
  return ethers.id(`agentremit:${jobId}`) as `0x${string}`;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function formatKeeperHubError(
  response: Response,
  path: string,
  body: string,
): string {
  const contentType = response.headers.get("content-type") ?? "";
  const trimmedBody = body.trim();
  const returnedHtml =
    contentType.includes("text/html") ||
    trimmedBody.toLowerCase().startsWith("<!doctype") ||
    trimmedBody.toLowerCase().startsWith("<html");

  if (returnedHtml) {
    return `KeeperHub request failed with ${response.status} at ${path}: endpoint returned an HTML page. Check KEEPERHUB_API_URL and the KeeperHub endpoint path.`;
  }

  if (trimmedBody) {
    try {
      const parsed = JSON.parse(trimmedBody) as Record<string, unknown>;
      const message =
        readString(parsed, "error") ??
        readString(parsed, "message") ??
        readString(parsed, "details");

      if (message) {
        return `KeeperHub request failed with ${response.status} at ${path}: ${message}`;
      }
    } catch {
      // Fall through to the raw body excerpt below.
    }
  }

  const excerpt = trimmedBody ? `: ${trimmedBody.slice(0, 300)}` : "";

  return `KeeperHub request failed with ${response.status} at ${path}${excerpt}`;
}
