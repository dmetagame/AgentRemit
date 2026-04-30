import { NextResponse } from "next/server";
import { processDueAgentJobs } from "@/lib/agent-worker";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResponse = authorizeWorkerRequest(request);

  if (authResponse) {
    return authResponse;
  }

  return runWorker();
}

export async function POST(request: Request) {
  const authResponse = authorizeWorkerRequest(request);

  if (authResponse) {
    return authResponse;
  }

  return runWorker();
}

async function runWorker() {
  const result = await processDueAgentJobs();

  return NextResponse.json(result);
}

function authorizeWorkerRequest(request: Request): Response | null {
  const secret = process.env.AGENTREMIT_WORKER_SECRET ?? process.env.CRON_SECRET;

  if (!secret) {
    return null;
  }

  const header = request.headers.get("authorization");

  if (header === `Bearer ${secret}`) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized worker request." }, { status: 401 });
}
