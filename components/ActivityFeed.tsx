"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/types";

type ActivityFeedProps = {
  events: AgentEvent[];
  status?: "idle" | "watching" | "executing" | "paused" | "cancelled" | "done" | "error";
};

const dotClasses: Record<AgentEvent["type"], string> = {
  job_created: "bg-[#0969da]",
  job_watching: "bg-[#1a7f37]",
  job_paused: "bg-[#bf8700]",
  job_resumed: "bg-[#1a7f37]",
  job_cancelled: "bg-[#cf222e]",
  target_updated: "bg-[#8250df]",
  rate_update: "bg-[#8c959f]",
  threshold_hit: "bg-[#bf8700]",
  quote_received: "bg-[#0969da]",
  job_submitted: "bg-[#0969da]",
  job_confirmed: "bg-[#1a7f37]",
  receipt_saved: "bg-[#1a7f37]",
  ens_updated: "bg-[#008080]",
  error: "bg-[#cf222e]",
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
    <section className="rounded-md border border-[#d8dee4] bg-white shadow-sm">
      <div className="border-b border-[#d8dee4] px-5 py-4">
        <h2 className="text-sm font-semibold text-[#24292f]">Activity</h2>
      </div>

      <div ref={scrollRef} className="max-h-[400px] overflow-y-auto">
        {shouldShowPaused ? (
          <div className="flex items-center gap-3 px-5 py-4 text-[13px] text-[#57606a]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#bf8700]" />
            Agent paused.
          </div>
        ) : shouldShowWatching ? (
          <div className="flex items-center gap-3 px-5 py-4 text-[13px] text-[#57606a]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#8c959f] opacity-80 animate-pulse" />
            Watching rates...
          </div>
        ) : orderedEvents.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-[#57606a]">
            No activity yet.
          </div>
        ) : (
          <ul className="divide-y divide-[#d8dee4]">
            {orderedEvents.map((event, index) => (
              <li
                key={`${event.timestamp}-${event.type}-${index}`}
                className={`agentremit-feed-row flex items-start gap-3 px-5 py-3 ${rowTone(event.type)}`}
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClasses[event.type]}`}
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 text-[13px] leading-5 text-[#24292f]">
                  {event.message}
                </p>
                <time
                  className="shrink-0 text-[11px] leading-5 text-[#6e7781]"
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
    return "bg-[#fff8c5]";
  }

  if (
    type === "job_watching" ||
    type === "job_resumed" ||
    type === "job_confirmed" ||
    type === "receipt_saved"
  ) {
    return "bg-[#dafbe1]";
  }

  if (type === "job_cancelled" || type === "error") {
    return "bg-[#fff1f1]";
  }

  return "bg-white";
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
