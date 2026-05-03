"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/types";

type ActivityFeedProps = {
  events: AgentEvent[];
  status?: "idle" | "watching" | "executing" | "paused" | "cancelled" | "done" | "error";
};

const dotClasses: Record<AgentEvent["type"], string> = {
  job_created: "bg-cyan-300",
  job_watching: "bg-emerald-300",
  job_paused: "bg-amber-300",
  job_resumed: "bg-emerald-300",
  job_cancelled: "bg-rose-300",
  target_updated: "bg-violet-300",
  rate_update: "bg-slate-400",
  threshold_hit: "bg-amber-300",
  quote_received: "bg-cyan-300",
  job_submitted: "bg-cyan-300",
  job_confirmed: "bg-emerald-300",
  receipt_saved: "bg-emerald-300",
  ens_updated: "bg-teal-300",
  error: "bg-rose-300",
};

export function ActivityFeed({ events, status }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const shouldShowWatching = events.length === 0 && status === "watching";
  const shouldShowPaused = events.length === 0 && status === "paused";
  const orderedEvents = useMemo(() => events, [events]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior: "smooth",
    });
  }, [orderedEvents.length]);

  return (
    <section className="agent-card overflow-hidden">
      <div className="agent-card-header px-5 py-4">
        <h2 className="text-sm font-semibold agent-heading">Activity</h2>
      </div>

      <div ref={scrollRef} className="max-h-[400px] overflow-y-auto">
        {shouldShowPaused ? (
          <div className="flex items-center gap-3 px-5 py-4 text-[13px] agent-muted">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
            Agent paused.
          </div>
        ) : shouldShowWatching ? (
          <div className="flex items-center gap-3 px-5 py-4 text-[13px] agent-muted">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 opacity-80 animate-pulse" />
            Watching rates...
          </div>
        ) : orderedEvents.length === 0 ? (
          <div className="px-5 py-4 text-[13px] agent-muted">
            No activity yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-700/40">
            {orderedEvents.map((event, index) => (
              <li
                key={`${event.timestamp}-${event.type}-${index}`}
                className={`agentremit-feed-row flex items-start gap-3 px-5 py-3 ${rowTone(event.type)}`}
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClasses[event.type]}`}
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 text-[13px] leading-5 agent-heading">
                  {event.message}
                </p>
                <time
                  className="shrink-0 text-[11px] leading-5 agent-subtle"
                  dateTime={new Date(normalizeTimestamp(event.timestamp)).toISOString()}
                >
                  {relativeTime(event.timestamp, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      <style jsx global>{`
        @keyframes agentremitFeedSlideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .agentremit-feed-row {
          animation: agentremitFeedSlideIn 180ms ease-out;
        }
      `}</style>
    </section>
  );
}

function rowTone(type: AgentEvent["type"]): string {
  if (type === "threshold_hit" || type === "job_paused") {
    return "agent-row-warning";
  }

  if (
    type === "job_watching" ||
    type === "job_resumed" ||
    type === "job_confirmed" ||
    type === "receipt_saved"
  ) {
    return "agent-row-success";
  }

  if (type === "job_cancelled" || type === "error") {
    return "agent-row-danger";
  }

  return "agent-row-neutral";
}

function relativeTime(timestamp: number, now: number): string {
  const diffSeconds = Math.max(
    0,
    Math.floor((now - normalizeTimestamp(timestamp)) / 1000),
  );

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}
