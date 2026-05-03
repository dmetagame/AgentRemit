"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSignMessage } from "wagmi";
import { buildSignedActionMessage } from "@/lib/auth";
import type { AgentJob } from "@/types";

type AgentControlsProps = {
  job: AgentJob | null;
  durable?: boolean;
  onJobUpdated: (job: AgentJob, durable?: boolean) => void;
};

type JobControlAction = "pause" | "resume" | "cancel" | "update_target";

type JobControlResponse = {
  job?: AgentJob;
  durable?: boolean;
  error?: string;
};

export function AgentControls({
  job,
  durable,
  onJobUpdated,
}: AgentControlsProps) {
  const { signMessageAsync } = useSignMessage();
  const [targetRate, setTargetRate] = useState("");
  const [pendingAction, setPendingAction] = useState<JobControlAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestMemoryProof = job?.zeroGMemoryProofs?.at(-1);
  const jobId = job?.id;
  const jobTargetRate = job?.config.targetRateNgn;
  const canPause = Boolean(job && isActiveState(job.state));
  const canResume = job?.state === "paused";
  const canCancel = Boolean(job && !isTerminalState(job.state));
  const canUpdateTarget = Boolean(job && !isTerminalState(job.state));
  const statusLabel = useMemo(() => {
    if (!job) {
      return "No active job";
    }

    return job.state.replace(/_/g, " ");
  }, [job]);

  useEffect(() => {
    if (typeof jobTargetRate === "number") {
      setTargetRate(jobTargetRate.toString());
    }
  }, [jobId, jobTargetRate]);

  async function submitControl(action: JobControlAction, nextTarget?: number) {
    if (!job) {
      return;
    }

    setPendingAction(action);
    setError(null);

    try {
      const payload = {
        jobId: job.id,
        action,
        targetRateNgn: nextTarget,
      };
      const signedAt = new Date().toISOString();
      const nonce = createNonce();
      const message = buildSignedActionMessage({
        action: "agent:control",
        payload,
        signedAt,
        nonce,
      });
      const signature = await signMessageAsync({ message });
      const response = await fetch(
        `/api/agent/jobs/${encodeURIComponent(job.id)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "agent:control",
            payload,
            signedAt,
            nonce,
            signature,
          }),
        },
      );
      const responsePayload = (await response.json()) as JobControlResponse;

      if (!response.ok || !responsePayload.job) {
        throw new Error(responsePayload.error ?? "Agent control request failed.");
      }

      onJobUpdated(responsePayload.job, responsePayload.durable);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Agent control request failed.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function updateTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextTarget = Number(targetRate);

    if (!Number.isFinite(nextTarget) || nextTarget <= 0) {
      setError("Target rate must be a positive number.");
      return;
    }

    await submitControl("update_target", nextTarget);
  }

  return (
    <section className="agent-card p-5">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase agent-subtle">
              Agent job
            </p>
            <h2 className="mt-1 text-xl font-semibold capitalize agent-heading">
              {statusLabel}
            </h2>
            {job ? (
              <p className="mt-2 break-all font-mono text-xs agent-subtle">
                {job.id}
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 agent-muted">
                Deploy an agent to create a server-side job.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="agent-button agent-button-secondary h-9 px-3 text-sm"
              disabled={!canPause || pendingAction !== null}
              onClick={() => submitControl("pause")}
            >
              {pendingAction === "pause" ? "Pausing" : "Pause"}
            </button>
            <button
              type="button"
              className="agent-button agent-button-primary h-9 px-3 text-sm"
              disabled={!canResume || pendingAction !== null}
              onClick={() => submitControl("resume")}
            >
              {pendingAction === "resume" ? "Resuming" : "Resume"}
            </button>
            <button
              type="button"
              className="agent-button agent-button-danger h-9 px-3 text-sm"
              disabled={!canCancel || pendingAction !== null}
              onClick={() => submitControl("cancel")}
            >
              {pendingAction === "cancel" ? "Cancelling" : "Cancel"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 border-t agent-divider pt-4 sm:grid-cols-3">
          <Metric label="Job store" value={durable ? "Redis durable" : "Memory fallback"} />
          <Metric
            label="0G memory"
            value={
              latestMemoryProof?.persistedToZeroG
                ? truncateHash(latestMemoryProof.rootHash ?? "")
                : latestMemoryProof
                  ? "Fallback recorded"
                  : "Pending"
            }
            title={latestMemoryProof?.rootHash ?? latestMemoryProof?.error ?? undefined}
          />
          <Metric
            label="Transitions"
            value={`${job?.zeroGMemoryProofs?.length ?? 0} recorded`}
          />
        </div>

        {job ? (
          <form
            className="flex flex-col gap-3 border-t agent-divider pt-4 sm:flex-row sm:items-end"
            onSubmit={updateTarget}
          >
            <label className="grid flex-1 gap-2 text-sm font-medium agent-heading">
              Target NGN rate
              <input
                className="agent-input h-10 px-3 text-sm font-normal"
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={targetRate}
                disabled={!canUpdateTarget || pendingAction !== null}
                onChange={(event) => setTargetRate(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="agent-button agent-button-primary h-10 px-4 text-sm"
              disabled={!canUpdateTarget || pendingAction !== null}
            >
              {pendingAction === "update_target" ? "Updating" : "Update target"}
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="agent-alert-danger rounded-md px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase agent-subtle">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold agent-heading" title={title}>
        {value}
      </p>
    </div>
  );
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

function isTerminalState(state: AgentJob["state"]): boolean {
  return (
    state === "done" ||
    state === "error" ||
    state === "cancelled" ||
    state === "stopped"
  );
}

function truncateHash(hash: string): string {
  if (!hash) {
    return "";
  }

  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function createNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
