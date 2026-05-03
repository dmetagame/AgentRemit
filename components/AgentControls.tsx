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
    <section className="rounded-md border border-[#d8dee4] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-[#6e7781]">
              Agent job
            </p>
            <h2 className="mt-1 text-xl font-semibold capitalize text-[#24292f]">
              {statusLabel}
            </h2>
            {job ? (
              <p className="mt-2 break-all font-mono text-xs text-[#57606a]">
                {job.id}
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-[#57606a]">
                Deploy an agent to create a server-side job.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-[#d8dee4] px-3 text-sm font-semibold text-[#24292f] transition hover:bg-[#f6f8fa] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canPause || pendingAction !== null}
              onClick={() => submitControl("pause")}
            >
              {pendingAction === "pause" ? "Pausing" : "Pause"}
            </button>
            <button
              type="button"
              className="h-9 rounded-md bg-[#0969da] px-3 text-sm font-semibold text-white transition hover:bg-[#075ebf] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canResume || pendingAction !== null}
              onClick={() => submitControl("resume")}
            >
              {pendingAction === "resume" ? "Resuming" : "Resume"}
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-[#ffebe9] px-3 text-sm font-semibold text-[#cf222e] transition hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canCancel || pendingAction !== null}
              onClick={() => submitControl("cancel")}
            >
              {pendingAction === "cancel" ? "Cancelling" : "Cancel"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 border-t border-[#d8dee4] pt-4 sm:grid-cols-3">
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
            className="flex flex-col gap-3 border-t border-[#d8dee4] pt-4 sm:flex-row sm:items-end"
            onSubmit={updateTarget}
          >
            <label className="grid flex-1 gap-2 text-sm font-medium text-[#24292f]">
              Target NGN rate
              <input
                className="h-10 rounded-md border border-[#d0d7de] px-3 text-sm font-normal text-[#101418] outline-none transition placeholder:text-[#8c959f] focus:border-[#1a7f37] focus:ring-2 focus:ring-[#1a7f37]/20"
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
              className="h-10 rounded-md bg-[#1a7f37] px-4 text-sm font-semibold text-white transition hover:bg-[#116329] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUpdateTarget || pendingAction !== null}
            >
              {pendingAction === "update_target" ? "Updating" : "Update target"}
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="rounded-md border border-[#ffebe9] bg-[#fff1f1] px-3 py-2 text-sm text-[#cf222e]">
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
      <p className="text-[11px] font-medium uppercase text-[#6e7781]">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-[#24292f]" title={title}>
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
