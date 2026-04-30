import { NextResponse } from "next/server";
import {
  addActiveAgentJob,
  getAgentJob,
  getAgentJobEvents,
  recordAgentJobEvent,
  removeActiveAgentJob,
  saveAgentJob,
  usesDurableAgentJobStore,
} from "@/lib/agent-job-store";
import {
  addressesEqual,
  authErrorResponse,
  verifySignedAction,
} from "@/lib/auth";
import { processAgentJob } from "@/lib/agent-worker";
import type { AgentEvent, AgentJob, AgentJobState } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await getAgentJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Agent job not found." }, { status: 404 });
  }

  return NextResponse.json({
    job,
    events: await getAgentJobEvents(jobId),
    durable: usesDurableAgentJobStore(),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const { payload, signerAddress } = await verifySignedAction<JobControlPayload>(
      body,
      "agent:control",
    );

    if (!isJobControlPayload(payload) || payload.jobId !== jobId) {
      return NextResponse.json(
        { error: "Expected jobId and a valid job control action." },
        { status: 400 },
      );
    }

    const job = await getAgentJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Agent job not found." }, { status: 404 });
    }

    if (!addressesEqual(job.config.ownerAddress, signerAddress)) {
      return NextResponse.json(
        { error: "Signed wallet must match the agent owner." },
        { status: 403 },
      );
    }

    const updatedJob = await applyJobControl(job, payload);

    return NextResponse.json({
      job: updatedJob,
      events: await getAgentJobEvents(jobId),
      durable: usesDurableAgentJobStore(),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AuthError") {
      return authErrorResponse(error);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update agent job.",
      },
      { status: 500 },
    );
  }
}

type JobControlPayload = {
  jobId: string;
  action: "pause" | "resume" | "cancel" | "update_target";
  targetRateNgn?: number;
};

async function applyJobControl(
  job: AgentJob,
  payload: JobControlPayload,
): Promise<AgentJob> {
  if (payload.action === "pause") {
    return pauseJob(job);
  }

  if (payload.action === "resume") {
    return resumeJob(job);
  }

  if (payload.action === "cancel") {
    return cancelJob(job);
  }

  return updateTargetRate(job, payload.targetRateNgn);
}

async function pauseJob(job: AgentJob): Promise<AgentJob> {
  if (isTerminalState(job.state)) {
    throw new Error("Completed jobs cannot be paused.");
  }

  if (job.state === "paused") {
    return job;
  }

  const nextJob = {
    ...job,
    state: "paused" as const,
    pausedFromState: isActiveJobState(job.state) ? job.state : "watching",
    message: "Agent paused by owner.",
    nextRunAt: Number.MAX_SAFE_INTEGER,
    lockedUntil: undefined,
  };

  await saveAgentJob(nextJob);
  await removeActiveAgentJob(job.id);
  await recordTransition(nextJob, {
    type: "job_paused",
    message: "Agent paused by owner.",
    data: { pausedFromState: nextJob.pausedFromState },
    timestamp: Date.now(),
  });

  return (await getAgentJob(job.id)) ?? nextJob;
}

async function resumeJob(job: AgentJob): Promise<AgentJob> {
  if (isTerminalState(job.state)) {
    throw new Error("Completed jobs cannot be resumed.");
  }

  if (job.state !== "paused") {
    return job;
  }

  const resumeState = isActiveJobState(job.pausedFromState)
    ? job.pausedFromState
    : "watching";
  const nextJob = {
    ...job,
    state: resumeState,
    pausedFromState: undefined,
    message: "Agent resumed by owner.",
    nextRunAt: Date.now(),
    lockedUntil: undefined,
  };

  await saveAgentJob(nextJob);
  await addActiveAgentJob(job.id);
  await recordTransition(nextJob, {
    type: "job_resumed",
    message: "Agent resumed by owner.",
    data: { state: resumeState },
    timestamp: Date.now(),
  });
  setTimeout(() => {
    void processAgentJob(job.id);
  }, 0);

  return (await getAgentJob(job.id)) ?? nextJob;
}

async function cancelJob(job: AgentJob): Promise<AgentJob> {
  if (isTerminalState(job.state)) {
    return job;
  }

  const nextJob = {
    ...job,
    state: "cancelled" as const,
    message: "Agent cancelled by owner.",
    nextRunAt: Number.MAX_SAFE_INTEGER,
    lockedUntil: undefined,
  };

  await saveAgentJob(nextJob);
  await removeActiveAgentJob(job.id);
  await recordTransition(nextJob, {
    type: "job_cancelled",
    message: "Agent cancelled by owner.",
    data: { cancelledFromState: job.state },
    timestamp: Date.now(),
  });

  return (await getAgentJob(job.id)) ?? nextJob;
}

async function updateTargetRate(
  job: AgentJob,
  targetRateNgn: number | undefined,
): Promise<AgentJob> {
  if (!Number.isFinite(targetRateNgn) || !targetRateNgn || targetRateNgn <= 0) {
    throw new Error("targetRateNgn must be a positive number.");
  }

  if (job.state === "cancelled" || job.state === "done" || job.state === "error") {
    throw new Error("Completed jobs cannot update their target rate.");
  }

  const nextJob = {
    ...job,
    config: {
      ...job.config,
      targetRateNgn,
    },
    message: `Target rate updated to ${targetRateNgn} NGN/USDC.`,
    nextRunAt: job.state === "paused" ? job.nextRunAt : Date.now(),
    lockedUntil: undefined,
  };

  await saveAgentJob(nextJob);

  if (job.state !== "paused") {
    await addActiveAgentJob(job.id);
  }

  await recordTransition(nextJob, {
    type: "target_updated",
    message: `Target rate updated to ${targetRateNgn} NGN/USDC.`,
    data: { targetRateNgn },
    timestamp: Date.now(),
  });

  if (job.state !== "paused") {
    setTimeout(() => {
      void processAgentJob(job.id);
    }, 0);
  }

  return (await getAgentJob(job.id)) ?? nextJob;
}

async function recordTransition(job: AgentJob, event: AgentEvent): Promise<void> {
  await recordAgentJobEvent(job, event);
}

function isJobControlPayload(value: unknown): value is JobControlPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<JobControlPayload>;

  return (
    typeof candidate.jobId === "string" &&
    (candidate.action === "pause" ||
      candidate.action === "resume" ||
      candidate.action === "cancel" ||
      candidate.action === "update_target")
  );
}

function isActiveJobState(
  state: AgentJobState | undefined,
): state is AgentJobState {
  return (
    state === "queued" ||
    state === "registering" ||
    state === "watching" ||
    state === "executing" ||
    state === "keeper_pending" ||
    state === "storing"
  );
}

function isTerminalState(state: AgentJobState): boolean {
  return (
    state === "done" ||
    state === "error" ||
    state === "cancelled" ||
    state === "stopped"
  );
}
