import { NextResponse } from "next/server";
import {
  addressesEqual,
  authErrorResponse,
  verifySignedAction,
} from "@/lib/auth";
import { createAgentJob, usesDurableAgentJobStore } from "@/lib/agent-job-store";
import { getAgentStatus, updateAgent } from "@/lib/agent";
import { processAgentJob } from "@/lib/agent-worker";
import type { AgentAction, AgentConfig } from "@/types";

export async function GET() {
  return NextResponse.json(await getAgentStatus());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  try {
    if (isSignedAgentControlRequest(body)) {
      const { payload } = await verifySignedAction<AgentControlPayload>(
        body,
        "agent:control",
      );

      if (payload.action !== "start" && payload.action !== "stop") {
        return NextResponse.json(
          { error: "Expected action to be either start or stop." },
          { status: 400 },
        );
      }

      return NextResponse.json(await updateAgent(payload.action));
    }

    const { payload, signerAddress } = await verifySignedAction<unknown>(
      body,
      "agent:deploy",
    );

    if (!isAgentConfig(payload)) {
      return NextResponse.json(
        {
          error:
            "Expected AgentConfig with ensName, ownerAddress, recipientAddress, amountUsdc, and targetRateNgn.",
        },
        { status: 400 },
      );
    }

    if (!addressesEqual(payload.ownerAddress, signerAddress)) {
      return NextResponse.json(
        { error: "Signed wallet must match ownerAddress." },
        { status: 403 },
      );
    }

    const job = await createAgentJob(payload);

    setTimeout(() => {
      void processAgentJob(job.id);
    }, 0);

    return NextResponse.json(
      {
        job,
        jobId: job.id,
        durable: usesDurableAgentJobStore(),
      },
      { status: 202 },
    );
  } catch (error) {
    if (isAuthLikeError(error)) {
      return authErrorResponse(error);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create agent job.",
      },
      { status: 500 },
    );
  }
}

type AgentControlPayload = {
  action?: AgentAction;
};

function isSignedAgentControlRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { action?: unknown }).action === "agent:control"
  );
}

function isAgentConfig(value: unknown): value is AgentConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AgentConfig>;

  return (
    typeof candidate.ensName === "string" &&
    typeof candidate.ownerAddress === "string" &&
    typeof candidate.recipientAddress === "string" &&
    typeof candidate.amountUsdc === "string" &&
    typeof candidate.targetRateNgn === "number"
  );
}

function isAuthLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AuthError";
}
