"use client";

import { useEffect, useMemo, useState } from "react";

type RateTrackerProps = {
  currentRate: number;
  targetRate: number;
  isWatching: boolean;
};

type RateResponse = {
  rate?: number;
};

const BASELINE_RATE = 1400;
const POLL_INTERVAL_MS = 30_000;

export function RateTracker({
  currentRate,
  targetRate,
  isWatching,
}: RateTrackerProps) {
  const [rate, setRate] = useState(currentRate);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [pulseKey, setPulseKey] = useState(0);
  const progress = useMemo(
    () => calculateProgress(rate, targetRate),
    [rate, targetRate],
  );
  const distanceToTarget = Math.max(0, targetRate - rate);
  const targetReached = rate >= targetRate;

  useEffect(() => {
    setRate(currentRate);
    setUpdatedAt(Date.now());
    setPulseKey((value) => value + 1);
  }, [currentRate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshRate() {
      try {
        const response = await fetch("/api/rates", { cache: "no-store" });
        const payload = (await response.json()) as RateResponse;

        if (!cancelled && typeof payload.rate === "number") {
          setRate(payload.rate);
          setUpdatedAt(Date.now());
          setPulseKey((value) => value + 1);
        }
      } catch {
        // Keep the last known rate visible if polling fails.
      }
    }

    const interval = setInterval(refreshRate, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="rounded-md border border-[#d8dee4] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2">
        <p
          key={pulseKey}
          className={`agentremit-rate-pulse text-[32px] font-medium leading-tight tracking-normal ${
            isWatching ? "text-[#24292f]" : "text-[#8c959f]"
          }`}
        >
          1 USDC = ₦
          {rate.toLocaleString("en-NG", {
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-sm text-[#6e7781]">
          {isWatching
            ? `Updated ${secondsAgo(updatedAt, now)} seconds ago`
            : "Agent not active"}
        </p>
      </div>

      <div className="mt-6">
        <div className="h-2 overflow-hidden rounded-full bg-[#eaeef2]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressFillClass(progress, targetReached)}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-[13px] text-[#6e7781]">
          {targetReached ? (
            <span className="font-medium text-[#1a7f37]">Target reached!</span>
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
          }
          50% {
            transform: scale(1.02);
          }
          100% {
            transform: scale(1);
          }
        }

        .agentremit-rate-pulse {
          transform-origin: left center;
          animation: agentremitRatePulse 300ms ease-out;
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
    return "bg-[#1a7f37]";
  }

  if (progress >= 60) {
    return "bg-[#bf8700]";
  }

  return "bg-[#8c959f]";
}

function secondsAgo(updatedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - updatedAt) / 1000));
}
