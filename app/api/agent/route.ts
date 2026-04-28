import { NextResponse } from "next/server";
import { getAgentStatus, RemittanceAgent, updateAgent } from "@/lib/agent";
import type { AgentAction, AgentConfig, AgentEvent } from "@/types";

export async function GET() {
  return NextResponse.json(await getAgentStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<AgentConfig> & {
    action?: AgentAction;
  };

  if (body.action) {
    if (body.action !== "start" && body.action !== "stop") {
      return NextResponse.json(
        { error: "Expected action to be either start or stop." },
        { status: 400 },
      );
    }

    return NextResponse.json(await updateAgent(body.action));
  }

  if (!isAgentConfig(body)) {
    return NextResponse.json(
      {
        error:
          "Expected AgentConfig with ensName, ownerAddress, recipientAddress, amountUsdc, and targetRateNgn.",
      },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const agent = new RemittanceAgent(body);
  let cancelStream: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) {
          return;
        }

        controller.enqueue(
          encoder.encode(`event: agent_event\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };

      const heartbeat = setInterval(() => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        agent.off("event", send);
        agent.off("done", close);
        agent.off("stopped", close);
      };
      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();
        cancelStream = null;
        controller.close();
      };
      cancelStream = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();
        agent.stop();
      };

      agent.on("event", send);
      agent.once("done", close);
      agent.once("stopped", close);
      void agent.start();
    },
    cancel() {
      cancelStream?.();
      cancelStream = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function isAgentConfig(value: Partial<AgentConfig>): value is AgentConfig {
  return (
    typeof value.ensName === "string" &&
    typeof value.ownerAddress === "string" &&
    typeof value.recipientAddress === "string" &&
    typeof value.amountUsdc === "string" &&
    typeof value.targetRateNgn === "number"
  );
}
