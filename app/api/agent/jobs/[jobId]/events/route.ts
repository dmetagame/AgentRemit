import { getAgentJob, getAgentJobEvents } from "@/lib/agent-job-store";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const encoder = new TextEncoder();
  let closed = false;
  let eventIndex = 0;
  let pollTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        if (!closed) {
          controller.enqueue(
            encoder.encode(`event: agent_event\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
      };
      const close = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (pollTimer) {
          clearInterval(pollTimer);
        }

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }

        controller.close();
      };
      const poll = async () => {
        if (closed) {
          return;
        }

        const [job, events] = await Promise.all([
          getAgentJob(jobId),
          getAgentJobEvents(jobId),
        ]);

        if (!job) {
          send({
            type: "error",
            message: "Agent job not found.",
            timestamp: Date.now(),
          });
          close();
          return;
        }

        events.slice(eventIndex).forEach(send);
        eventIndex = events.length;

        if (
          job.state === "done" ||
          job.state === "error" ||
          job.state === "cancelled" ||
          job.state === "stopped"
        ) {
          close();
        }
      };

      heartbeatTimer = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      }, 15000);
      pollTimer = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);

      await poll();
    },
    cancel() {
      closed = true;

      if (pollTimer) {
        clearInterval(pollTimer);
      }

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
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
