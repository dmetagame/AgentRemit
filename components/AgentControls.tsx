"use client";

import { useState } from "react";
import type { AgentAction, AgentStatus } from "@/types";

const initialStatus: AgentStatus = {
  state: "idle",
  message: "Agent is ready and has not been started.",
};

export function AgentControls() {
  const [status, setStatus] = useState<AgentStatus>(initialStatus);
  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null);

  async function submit(action: AgentAction) {
    setPendingAction(action);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      const payload = (await response.json()) as AgentStatus;

      if (!response.ok) {
        throw new Error("Agent request failed");
      }

      setStatus(payload);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="rounded-md border border-[#d8dee4] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#57606a]">Agent</p>
          <h2 className="mt-1 text-2xl font-semibold capitalize">
            {status.state}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#57606a]">
            {status.message}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            className="h-10 flex-1 rounded-md bg-[#0969da] px-4 text-sm font-semibold text-white transition hover:bg-[#075ebf] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            disabled={pendingAction !== null}
            onClick={() => submit("start")}
          >
            {pendingAction === "start" ? "Starting" : "Start"}
          </button>
          <button
            type="button"
            className="h-10 flex-1 rounded-md border border-[#d8dee4] px-4 text-sm font-semibold text-[#24292f] transition hover:bg-[#f6f8fa] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            disabled={pendingAction !== null}
            onClick={() => submit("stop")}
          >
            {pendingAction === "stop" ? "Stopping" : "Stop"}
          </button>
        </div>
      </div>
    </section>
  );
}
