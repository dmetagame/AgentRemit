"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentControls } from "@/components/AgentControls";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ConnectButton as ConnectWalletButton } from "@/components/ConnectButton";
import { RateTracker } from "@/components/RateTracker";
import { ReceiptsTable } from "@/components/ReceiptsTable";
import { SetupForm } from "@/components/SetupForm";
import type { AgentConfig, AgentEvent, AgentJob, RateQuote } from "@/types";

type DashboardState =
  | "idle"
  | "configuring"
  | "watching"
  | "executing"
  | "paused"
  | "cancelled"
  | "done"
  | "error";

type RateResponse = {
  rate?: number;
  asOf?: string;
};

type JobResponse = {
  job?: AgentJob;
  durable?: boolean;
  error?: string;
};

const DEFAULT_RATE = 1500;
const DEFAULT_TARGET_SPREAD = 100;
const RATE_POLL_INTERVAL_MS = 30_000;
const SEEDED_AGENT_HANDLE = "sends-ada-home.agentremit.eth";

export default function Home() {
  const [state, setState] = useState<DashboardState>("idle");
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [activeJob, setActiveJob] = useState<AgentJob | null>(null);
  const [jobDurable, setJobDurable] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [currentRate, setCurrentRate] = useState(DEFAULT_RATE);
  const [rateUpdatedAt, setRateUpdatedAt] = useState(() => Date.now());
  const [receiptsRefreshKey, setReceiptsRefreshKey] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRate() {
      try {
        const response = await fetch("/api/rates", { cache: "no-store" });
        const payload = (await response.json()) as RateResponse;

        if (
          !cancelled &&
          typeof payload.rate === "number" &&
          Number.isFinite(payload.rate) &&
          payload.rate > 0
        ) {
          setCurrentRate(payload.rate);
          setRateUpdatedAt(readTimestamp(payload.asOf) ?? Date.now());
        }
      } catch {
        if (!cancelled) {
          setRateUpdatedAt(Date.now());
        }
      }
    }

    void loadRate();
    const interval = setInterval(loadRate, RATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setState("configuring");
  }, []);

  const applyJobToDashboard = useCallback((job: AgentJob, durable?: boolean) => {
    setActiveJob(job);
    setAgentConfig(job.config);
    setState(mapJobState(job.state));

    if (typeof durable === "boolean") {
      setJobDurable(durable);
    }

    if (job.receipt) {
      setReceiptsRefreshKey((value) => value + 1);
    }
  }, []);

  const loadJob = useCallback(
    async (jobId: string) => {
      const response = await fetch(`/api/agent/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as JobResponse;

      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "Unable to load agent job.");
      }

      applyJobToDashboard(payload.job, payload.durable);
    },
    [applyJobToDashboard],
  );

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    setEvents((existing) => [...existing, event]);

    if (event.type === "job_created" || event.type === "job_watching") {
      setState("watching");
      return;
    }

    if (event.type === "job_paused") {
      setState("paused");
      return;
    }

    if (event.type === "job_resumed") {
      setState("watching");
      return;
    }

    if (event.type === "job_cancelled") {
      setState("cancelled");
      return;
    }

    if (event.type === "target_updated") {
      const targetRateNgn =
        typeof event.data?.targetRateNgn === "number"
          ? event.data.targetRateNgn
          : null;

      if (targetRateNgn) {
        setAgentConfig((config) =>
          config ? { ...config, targetRateNgn } : config,
        );
      }

      return;
    }

    if (event.type === "rate_update") {
      setState((current) =>
        current === "idle" || current === "configuring" ? "watching" : current,
      );
      const rateQuote = readRateQuote(event);
      const rate = rateQuote?.rate ?? readRate(event);

      if (typeof rate === "number") {
        setCurrentRate(rate);
        setRateUpdatedAt(readTimestamp(rateQuote?.asOf) ?? Date.now());
      }
      return;
    }

    if (
      event.type === "threshold_hit" ||
      event.type === "quote_received" ||
      event.type === "job_submitted"
    ) {
      setState("executing");
      return;
    }

    if (event.type === "job_confirmed" || event.type === "receipt_saved") {
      setState(event.type === "receipt_saved" ? "done" : "executing");
      if (event.type === "receipt_saved") {
        setReceiptsRefreshKey((value) => value + 1);
      }
      return;
    }

    if (event.type === "ens_updated") {
      const ensName =
        typeof event.data?.ensName === "string" ? event.data.ensName : null;

      if (ensName) {
        setAgentConfig((config) =>
          config ? { ...config, ensName } : config,
        );
      }

      setState((current) => (current === "done" ? "done" : current));
      return;
    }

    if (event.type === "error") {
      setState("error");
    }
  }, []);

  const handleAgentStarted = useCallback(
    (config: AgentConfig, job: AgentJob, durable?: boolean) => {
      setAgentConfig(config);
      setActiveJob(job);
      setJobDurable(Boolean(durable));
      setEvents([]);
      setState("watching");
      eventSourceRef.current?.close();

      const eventSource = new EventSource(
        `/api/agent/jobs/${encodeURIComponent(job.id)}/events`,
      );

      eventSource.addEventListener("agent_event", (messageEvent) => {
        const event = parseEventSourceMessage(messageEvent);

        if (event) {
          handleAgentEvent(event);
        }
      });
      eventSource.onerror = () => {
        eventSource.close();
        eventSourceRef.current = null;
      };
      eventSourceRef.current = eventSource;
    },
    [handleAgentEvent],
  );

  const activeJobId = activeJob?.id;
  const activeJobState = activeJob?.state;

  useEffect(() => {
    if (!activeJobId || !activeJobState || isTerminalJobState(activeJobState)) {
      return;
    }

    const interval = setInterval(() => {
      void loadJob(activeJobId).catch(() => undefined);
    }, 5000);

    return () => clearInterval(interval);
  }, [activeJobId, activeJobState, loadJob]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const targetRate =
    agentConfig?.targetRateNgn ?? Math.round(currentRate + DEFAULT_TARGET_SPREAD);
  const isWatching = state === "watching" || state === "executing";
  const receiptsAgentHandle = agentConfig?.ensName ?? SEEDED_AGENT_HANDLE;

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#101418]">
      <nav className="border-b border-[#d8dee4] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <div>
            <p className="text-xl font-semibold tracking-normal text-[#101418]">
              AgentRemit
            </p>
            <p className="mt-1 text-sm text-[#57606a]">
              Send money home, automatically
            </p>
          </div>
          <ConnectWalletButton />
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-2 lg:px-12">
        <section className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-[#1a7f37]">
              Set up your agent
            </p>
            <h1 className="mt-2 text-[18px] font-semibold text-[#24292f]">
              Deploy your remittance agent
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#57606a]">
              {leftColumnMessage(state)}
            </p>
          </div>

          <SetupForm
            currentRate={currentRate}
            onAgentStarted={handleAgentStarted}
          />

          <AgentControls
            job={activeJob}
            durable={jobDurable}
            onJobUpdated={applyJobToDashboard}
          />

          {agentConfig ? (
            <div className="rounded-md border border-[#d8dee4] bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase text-[#6e7781]">
                0G agent handle
              </p>
              <p className="mt-2 break-all font-mono text-sm text-[#24292f]">
                {agentConfig.ensName}
              </p>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-[#1a7f37]">
              Live monitoring
            </p>
            <h2 className="mt-2 text-[18px] font-semibold text-[#24292f]">
              {rightColumnHeading(state)}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#57606a]">
              {rightColumnMessage(state)}
            </p>
          </div>

          <RateTracker
            currentRate={currentRate}
            targetRate={targetRate}
            isWatching={isWatching}
            updatedAt={rateUpdatedAt}
          />

          <ActivityFeed events={events} status={activityStatus(state)} />

          <ReceiptsTable
            agentEnsName={receiptsAgentHandle}
            refreshKey={receiptsRefreshKey}
          />
        </section>
      </div>
    </main>
  );
}

function parseEventSourceMessage(event: MessageEvent): AgentEvent | null {
  try {
    return JSON.parse(event.data) as AgentEvent;
  } catch {
    return null;
  }
}

function readRate(event: AgentEvent): number | null {
  const rate = event.data?.rate;

  if (isRateQuote(rate)) {
    return rate.rate;
  }

  if (typeof event.data?.currentRate === "number") {
    return event.data.currentRate;
  }

  return null;
}

function readRateQuote(event: AgentEvent): RateQuote | null {
  const rate = event.data?.rate;

  return isRateQuote(rate) ? rate : null;
}

function isRateQuote(value: unknown): value is RateQuote {
  return (
    typeof value === "object" &&
    value !== null &&
    "rate" in value &&
    typeof (value as { rate?: unknown }).rate === "number"
  );
}

function readTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function activityStatus(state: DashboardState) {
  if (state === "executing" || state === "watching" || state === "paused") {
    return state;
  }

  if (state === "error") {
    return "error";
  }

  if (state === "done") {
    return "done";
  }

  if (state === "cancelled") {
    return "cancelled";
  }

  return "idle";
}

function mapJobState(state: AgentJob["state"]): DashboardState {
  if (state === "paused") {
    return "paused";
  }

  if (state === "cancelled" || state === "stopped") {
    return "cancelled";
  }

  if (state === "done") {
    return "done";
  }

  if (state === "error") {
    return "error";
  }

  if (
    state === "executing" ||
    state === "keeper_pending" ||
    state === "storing"
  ) {
    return "executing";
  }

  return "watching";
}

function isTerminalJobState(state: AgentJob["state"]): boolean {
  return (
    state === "done" ||
    state === "error" ||
    state === "cancelled" ||
    state === "stopped"
  );
}

function leftColumnMessage(state: DashboardState): string {
  if (state === "idle") {
    return "Connect your wallet, set the recipient, and choose the rate that should trigger the transfer.";
  }

  if (state === "watching") {
    return "Your agent is deployed and waiting for the right rate.";
  }

  if (state === "executing") {
    return "The target has been reached. Settlement is being prepared.";
  }

  if (state === "paused") {
    return "Your durable agent job is paused. Resume it when you want rate monitoring to continue.";
  }

  if (state === "cancelled") {
    return "This agent job is cancelled. Deploy another agent to start a new remittance watch.";
  }

  if (state === "done") {
    return "The latest transfer is confirmed and recorded.";
  }

  if (state === "error") {
    return "Review the activity feed, adjust details if needed, and deploy again.";
  }

  return "Complete the details below to prepare your remittance agent.";
}

function rightColumnHeading(state: DashboardState): string {
  if (state === "executing") {
    return "Transfer in progress";
  }

  if (state === "done") {
    return "Transfer complete";
  }

  if (state === "error") {
    return "Action needed";
  }

  if (state === "paused") {
    return "Paused";
  }

  if (state === "cancelled") {
    return "Cancelled";
  }

  return "Rate watch";
}

function rightColumnMessage(state: DashboardState): string {
  if (state === "idle" || state === "configuring") {
    return "Live USDC/NGN rates update every 30 seconds. Deploy an agent to act on your target.";
  }

  if (state === "watching") {
    return "The agent is checking the USDC/NGN rate and will act when your target is reached.";
  }

  if (state === "executing") {
    return "The agent is submitting and tracking the payment job.";
  }

  if (state === "paused") {
    return "The server-side job is retained, but the worker will not advance it until resumed.";
  }

  if (state === "cancelled") {
    return "The server-side job stopped advancing and its cancellation was recorded.";
  }

  if (state === "done") {
    return "A receipt is available once the storage record is indexed.";
  }

  return "The agent reported an issue during execution.";
}
