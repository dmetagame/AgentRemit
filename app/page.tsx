"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ConnectButton as ConnectWalletButton } from "@/components/ConnectButton";
import { RateTracker } from "@/components/RateTracker";
import { ReceiptsTable } from "@/components/ReceiptsTable";
import { SetupForm } from "@/components/SetupForm";
import type { AgentConfig, AgentEvent, RateQuote } from "@/types";

type DashboardState =
  | "idle"
  | "configuring"
  | "watching"
  | "executing"
  | "done"
  | "error";

type RateResponse = {
  rate?: number;
};

const DEFAULT_RATE = 1500;
const DEFAULT_TARGET_SPREAD = 100;

export default function Home() {
  const [state, setState] = useState<DashboardState>("idle");
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [currentRate, setCurrentRate] = useState(DEFAULT_RATE);
  const [hasConfirmedTransaction, setHasConfirmedTransaction] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRate() {
      try {
        const response = await fetch("/api/rates", { cache: "no-store" });
        const payload = (await response.json()) as RateResponse;

        if (!cancelled && typeof payload.rate === "number") {
          setCurrentRate(payload.rate);
        }
      } catch {
        if (!cancelled) {
          setCurrentRate(DEFAULT_RATE);
        }
      }
    }

    void loadRate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setState("configuring");
  }, []);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    setEvents((existing) => [...existing, event]);

    if (event.type === "rate_update") {
      setState((current) =>
        current === "idle" || current === "configuring" ? "watching" : current,
      );
      const rate = readRate(event);

      if (typeof rate === "number") {
        setCurrentRate(rate);
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
      setHasConfirmedTransaction(true);
      setState(event.type === "receipt_saved" ? "done" : "executing");
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
    (config: AgentConfig, eventStream?: ReadableStream<Uint8Array> | null) => {
      setAgentConfig(config);
      setEvents([]);
      setHasConfirmedTransaction(false);
      setState("watching");

      if (eventStream) {
        void readAgentEvents(eventStream, handleAgentEvent, () => {
          setState((current) =>
            current === "watching" || current === "executing" ? "done" : current,
          );
        });
      }
    },
    [handleAgentEvent],
  );

  const targetRate =
    agentConfig?.targetRateNgn ?? Math.round(currentRate + DEFAULT_TARGET_SPREAD);
  const isWatching = state === "watching" || state === "executing";

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

          <SetupForm onAgentStarted={handleAgentStarted} />

          {agentConfig ? (
            <div className="rounded-md border border-[#d8dee4] bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase text-[#6e7781]">
                Your agent identity
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
          />

          <ActivityFeed events={events} status={activityStatus(state)} />

          {hasConfirmedTransaction && agentConfig ? (
            <ReceiptsTable agentEnsName={agentConfig.ensName} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

async function readAgentEvents(
  eventStream: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
  onDone: () => void,
) {
  const reader = eventStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const event = parseSseBlock(block);

        if (event) {
          onEvent(event);
        }
      }
    }
  } finally {
    reader.releaseLock();
    onDone();
  }
}

function parseSseBlock(block: string): AgentEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as AgentEvent;
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

function isRateQuote(value: unknown): value is RateQuote {
  return (
    typeof value === "object" &&
    value !== null &&
    "rate" in value &&
    typeof (value as { rate?: unknown }).rate === "number"
  );
}

function activityStatus(state: DashboardState) {
  if (state === "executing" || state === "watching") {
    return state;
  }

  if (state === "error") {
    return "error";
  }

  if (state === "done") {
    return "done";
  }

  return "idle";
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

  return "Rate watch";
}

function rightColumnMessage(state: DashboardState): string {
  if (state === "idle" || state === "configuring") {
    return "Live rate tracking starts after deployment.";
  }

  if (state === "watching") {
    return "The agent is checking the NGN/USDC rate and will act when your target is reached.";
  }

  if (state === "executing") {
    return "The agent is submitting and tracking the payment job.";
  }

  if (state === "done") {
    return "A receipt is available once the storage record is indexed.";
  }

  return "The agent reported an issue during execution.";
}
