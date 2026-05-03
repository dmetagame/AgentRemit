"use client";

import { useEffect, useMemo, useState } from "react";

type RateTrackerProps = {
  currentRate: number;
  targetRate: number;
  isWatching: boolean;
  updatedAt: number;
  source: string;
  executable: boolean;
};

const BASELINE_RATE = 1400;

export function RateTracker({
  currentRate,
  targetRate,
  isWatching,
  updatedAt,
  source,
  executable,
}: RateTrackerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [pulseKey, setPulseKey] = useState(0);
  const progress = useMemo(
    () => calculateProgress(currentRate, targetRate),
    [currentRate, targetRate],
  );
  const distanceToTarget = Math.max(0, targetRate - currentRate);
  const targetReached = currentRate >= targetRate;
  const isFallbackRate = source === "fallback";

  useEffect(() => {
    setPulseKey((value) => value + 1);
  }, [currentRate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <section className="agent-card p-5">
      <div className="flex flex-col gap-2">
        <p
          key={pulseKey}
          className="agentremit-rate-pulse text-[32px] font-semibold leading-tight tracking-normal agent-heading"
        >
          1 USDC = ₦
          {currentRate.toLocaleString("en-NG", {
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-sm agent-muted">
          {isWatching ? "Agent watching" : rateLabel(source)} - Updated{" "}
          {formatAge(updatedAt, now)} from {sourceLabel(source)}
        </p>
      </div>

      {isFallbackRate || !executable ? (
        <div className="agent-alert-warning mt-4 rounded-md px-3 py-2 text-[13px] leading-5">
          This is a display-only fallback rate. Agent execution will wait until a
          live FX source is configured.
        </div>
      ) : null}

      <div className="mt-6">
        <div className="agent-progress-track h-2 overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressFillClass(progress, targetReached)}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-[13px] agent-subtle">
          {targetReached ? (
            <span className="font-medium agent-success">Target reached!</span>
          ) : (
            `${distanceToTarget.toLocaleString("en-NG", {
              maximumFractionDigits: 2,
            })} NGN away from target`
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes agentremitRatePulse {
          0% {
            transform: scale(1);
            text-shadow: 0 0 0 rgba(103, 232, 249, 0);
          }
          50% {
            transform: scale(1.01);
            text-shadow: 0 0 22px rgba(103, 232, 249, 0.2);
          }
          100% {
            transform: scale(1);
            text-shadow: 0 0 0 rgba(103, 232, 249, 0);
          }
        }

        .agentremit-rate-pulse {
          transform-origin: left center;
          animation: agentremitRatePulse 700ms ease-out;
        }
      `}</style>
    </section>
  );
}

function calculateProgress(rate: number, targetRate: number): number {
  if (targetRate <= BASELINE_RATE) {
    return rate >= targetRate ? 100 : 0;
  }

  return Math.min(
    100,
    Math.max(0, ((rate - BASELINE_RATE) / (targetRate - BASELINE_RATE)) * 100),
  );
}

function progressFillClass(progress: number, targetReached: boolean): string {
  if (targetReached || progress >= 90) {
    return "agent-progress-good";
  }

  if (progress >= 60) {
    return "agent-progress-mid";
  }

  return "agent-progress-low";
}

function rateLabel(source: string): string {
  return source === "fallback" ? "Fallback display rate" : "Live market rate";
}

function sourceLabel(source: string): string {
  if (source === "fallback") {
    return "fallback";
  }

  if (source === "exchangerate-api") {
    return "ExchangeRate API";
  }

  if (source === "open-er-api") {
    return "Open ExchangeRate API";
  }

  return source || "unknown source";
}

function formatAge(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  return `${Math.floor(seconds / 60)}m ago`;
}
