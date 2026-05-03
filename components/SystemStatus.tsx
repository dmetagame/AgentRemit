"use client";

import { useEffect, useState } from "react";

type RuntimeReadinessResponse = {
  canDeploy?: boolean;
  canExecuteLive?: boolean;
  warnings?: string[];
  jobStore?: {
    durable?: boolean;
    required?: boolean;
  };
  rate?: {
    source?: string;
    executable?: boolean;
    fallback?: boolean;
  };
  execution?: {
    mode?: "mock" | "live" | "disabled";
    reason?: string | null;
  };
  zeroG?: {
    configured?: boolean;
  };
};

export function SystemStatus() {
  const [readiness, setReadiness] = useState<RuntimeReadinessResponse | null>(
    null,
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadReadiness() {
      try {
        const response = await fetch("/api/readiness", {
          cache: "no-store",
          signal: abortController.signal,
        });

        if (!response.ok) {
          return;
        }

        setReadiness((await response.json()) as RuntimeReadinessResponse);
      } catch {
        if (!abortController.signal.aborted) {
          setReadiness(null);
        }
      }
    }

    void loadReadiness();

    return () => abortController.abort();
  }, []);

  if (!readiness || readiness.warnings?.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-[#d8dee4] bg-[#fff8c5]">
      <div className="mx-auto grid max-w-7xl gap-3 px-5 py-4 text-sm text-[#5f3b00] sm:px-8 lg:grid-cols-[auto_1fr] lg:px-12">
        <p className="font-semibold">Production readiness</p>
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2 text-[12px] font-medium">
            <StatusPill
              label="Jobs"
              value={readiness.jobStore?.durable ? "Redis" : "memory"}
              ok={Boolean(readiness.jobStore?.durable)}
            />
            <StatusPill
              label="Rates"
              value={readiness.rate?.source ?? "unknown"}
              ok={Boolean(readiness.rate?.executable)}
            />
            <StatusPill
              label="Execution"
              value={readiness.execution?.mode ?? "unknown"}
              ok={readiness.execution?.mode === "live"}
            />
            <StatusPill
              label="0G"
              value={readiness.zeroG?.configured ? "configured" : "fallback"}
              ok={Boolean(readiness.zeroG?.configured)}
            />
          </div>
          <ul className="grid gap-1 text-[13px] leading-5">
            {(readiness.warnings ?? []).slice(0, 3).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function StatusPill({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <span
      className={`rounded-md border px-2 py-1 ${
        ok
          ? "border-[#8ddb8c] bg-[#dafbe1] text-[#1a7f37]"
          : "border-[#d4a72c] bg-[#fffdef] text-[#7d4e00]"
      }`}
    >
      {label}: {value}
    </span>
  );
}
