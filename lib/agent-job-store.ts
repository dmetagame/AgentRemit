import type {
  AgentConfig,
  AgentEvent,
  AgentJob,
  AgentMemoryProof,
  RemittanceReceipt,
} from "@/types";
import * as storage from "@/lib/storage";

const JOB_KEY_PREFIX = "agentremit:jobs";
const EVENT_KEY_PREFIX = "agentremit:job-events";
const RECEIPT_KEY_PREFIX = "agentremit:agent-receipts";
const ACTIVE_JOBS_KEY = "agentremit:active-jobs";
const EVENT_LIMIT = 100;
const RECEIPT_LIMIT = 100;
const memoryJobs = new Map<string, AgentJob>();
const memoryEvents = new Map<string, AgentEvent[]>();
const memoryReceipts = new Map<string, RemittanceReceipt[]>();
const memoryActiveJobs = new Set<string>();

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

export async function createAgentJob(config: AgentConfig): Promise<AgentJob> {
  assertAgentJobStoreReady();

  const now = Date.now();
  const job: AgentJob = {
    id: createJobId(),
    config,
    state: "queued",
    message: "Agent job queued.",
    createdAt: now,
    updatedAt: now,
    nextRunAt: now,
  };

  await saveAgentJob(job);
  await addActiveAgentJob(job.id);
  await recordAgentJobEvent(job, {
    type: "job_created",
    message: `Agent job ${job.id} created`,
    data: { jobId: job.id, targetRateNgn: config.targetRateNgn },
    timestamp: now,
  });
  await appendAgentJobEvent(job.id, {
    type: "job_submitted",
    message: `Agent job ${job.id} queued`,
    data: { jobId: job.id },
    timestamp: now,
  });

  return job;
}

export async function getAgentJob(jobId: string): Promise<AgentJob | null> {
  if (!usesRedisStore()) {
    return memoryJobs.get(jobId) ?? null;
  }

  const rawJob = await redisCommand<string | null>("GET", jobKey(jobId));

  return rawJob ? (JSON.parse(rawJob) as AgentJob) : null;
}

export async function saveAgentJob(job: AgentJob): Promise<void> {
  const updatedJob = {
    ...job,
    updatedAt: Date.now(),
  };

  if (!usesRedisStore()) {
    memoryJobs.set(updatedJob.id, updatedJob);
    return;
  }

  await redisCommand("SET", jobKey(updatedJob.id), JSON.stringify(updatedJob));
}

export async function appendAgentJobEvent(
  jobId: string,
  event: AgentEvent,
): Promise<void> {
  if (!usesRedisStore()) {
    const events = memoryEvents.get(jobId) ?? [];
    memoryEvents.set(jobId, [...events, event].slice(-EVENT_LIMIT));
    return;
  }

  await redisCommand("RPUSH", eventKey(jobId), JSON.stringify(event));
  await redisCommand("LTRIM", eventKey(jobId), -EVENT_LIMIT, -1);
}

export async function recordAgentJobEvent(
  job: AgentJob,
  event: AgentEvent,
): Promise<void> {
  await appendAgentJobEvent(job.id, event);

  const result = await storage.appendToAgentLog(
    job.config.ensName,
    JSON.stringify({
      jobId: job.id,
      agentHandle: job.config.ensName,
      state: job.state,
      event,
      recordedAt: new Date().toISOString(),
    }),
  );
  const proof: AgentMemoryProof = {
    eventType: event.type,
    message: event.message,
    timestamp: event.timestamp,
    key: result.key,
    persistedToZeroG: result.persistedToZeroG,
    rootHash: result.rootHash,
    txHash: result.txHash,
    error: result.error,
  };
  const latestJob = await getAgentJob(job.id);

  if (!latestJob) {
    return;
  }

  await saveAgentJob({
    ...latestJob,
    zeroGMemoryProofs: [
      ...(latestJob.zeroGMemoryProofs ?? []),
      proof,
    ].slice(-30),
  });
}

export async function getAgentJobEvents(jobId: string): Promise<AgentEvent[]> {
  if (!usesRedisStore()) {
    return memoryEvents.get(jobId) ?? [];
  }

  const rawEvents = await redisCommand<string[]>("LRANGE", eventKey(jobId), 0, -1);

  return rawEvents.map((event) => JSON.parse(event) as AgentEvent);
}

export async function saveAgentReceipt(
  receipt: RemittanceReceipt,
): Promise<void> {
  if (!usesRedisStore()) {
    const receipts = memoryReceipts.get(receipt.agentEnsName) ?? [];
    memoryReceipts.set(
      receipt.agentEnsName,
      upsertReceipt(receipts, receipt).slice(-RECEIPT_LIMIT),
    );
    return;
  }

  const key = receiptKey(receipt.agentEnsName);
  const receipts = await getAgentReceipts(receipt.agentEnsName);
  const nextReceipts = upsertReceipt(receipts, receipt).slice(-RECEIPT_LIMIT);

  await redisCommand("SET", key, JSON.stringify(nextReceipts));
}

export async function getAgentReceipts(
  agentEnsName: string,
): Promise<RemittanceReceipt[]> {
  if (!usesRedisStore()) {
    return memoryReceipts.get(agentEnsName) ?? [];
  }

  const rawReceipts = await redisCommand<string | null>(
    "GET",
    receiptKey(agentEnsName),
  );

  return rawReceipts ? (JSON.parse(rawReceipts) as RemittanceReceipt[]) : [];
}

export async function listDueAgentJobs(limit = 5): Promise<AgentJob[]> {
  const now = Date.now();
  const jobIds = await listActiveAgentJobIds();
  const jobs: AgentJob[] = [];

  for (const jobId of jobIds) {
    if (jobs.length >= limit) {
      break;
    }

    const job = await getAgentJob(jobId);

    if (!job) {
      await removeActiveAgentJob(jobId);
      continue;
    }

    if (job.nextRunAt <= now && isActiveJobState(job.state)) {
      jobs.push(job);
    }
  }

  return jobs;
}

export async function addActiveAgentJob(jobId: string): Promise<void> {
  if (!usesRedisStore()) {
    memoryActiveJobs.add(jobId);
    return;
  }

  await redisCommand("SADD", ACTIVE_JOBS_KEY, jobId);
}

export async function removeActiveAgentJob(jobId: string): Promise<void> {
  if (!usesRedisStore()) {
    memoryActiveJobs.delete(jobId);
    return;
  }

  await redisCommand("SREM", ACTIVE_JOBS_KEY, jobId);
}

export function usesDurableAgentJobStore(): boolean {
  return usesRedisStore();
}

export function requiresDurableAgentJobStore(): boolean {
  if (process.env.AGENTREMIT_REQUIRE_DURABLE_JOBS === "true") {
    return true;
  }

  if (process.env.AGENTREMIT_ALLOW_MEMORY_JOBS === "true") {
    return false;
  }

  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

export function assertAgentJobStoreReady(): void {
  if (requiresDurableAgentJobStore() && !usesDurableAgentJobStore()) {
    throw new Error(
      "Durable agent jobs require UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in production. Set AGENTREMIT_ALLOW_MEMORY_JOBS=true only for a clearly labeled demo.",
    );
  }
}

function isActiveJobState(state: AgentJob["state"]): boolean {
  return (
    state === "queued" ||
    state === "registering" ||
    state === "watching" ||
    state === "executing" ||
    state === "keeper_pending" ||
    state === "storing"
  );
}

async function listActiveAgentJobIds(): Promise<string[]> {
  if (!usesRedisStore()) {
    return Array.from(memoryActiveJobs);
  }

  return redisCommand<string[]>("SMEMBERS", ACTIVE_JOBS_KEY);
}

async function redisCommand<T = unknown>(
  command: string,
  ...args: Array<string | number>
): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([command, ...args]),
    cache: "no-store",
  });
  const payload = (await response.json()) as RedisResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Redis command ${command} failed`);
  }

  return payload.result as T;
}

function usesRedisStore(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function jobKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}:${jobId}`;
}

function eventKey(jobId: string): string {
  return `${EVENT_KEY_PREFIX}:${jobId}`;
}

function receiptKey(agentEnsName: string): string {
  return `${RECEIPT_KEY_PREFIX}:${agentEnsName}`;
}

function upsertReceipt(
  receipts: RemittanceReceipt[],
  receipt: RemittanceReceipt,
): RemittanceReceipt[] {
  const withoutDuplicate = receipts.filter((item) => item.id !== receipt.id);

  return [...withoutDuplicate, receipt].sort((left, right) => {
    return left.timestamp - right.timestamp;
  });
}

function createJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `job_${crypto.randomUUID()}`;
  }

  return `job_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}
