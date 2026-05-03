import "dotenv/config";

const DEFAULT_DESTINATION =
  "https://agentremit-gamma.vercel.app/api/agent/worker";
const DEFAULT_QSTASH_URL = "https://qstash.upstash.io";
const DEFAULT_CRON = "* * * * *";
const DEFAULT_SCHEDULE_ID = "agentremit-worker-production";

async function main() {
  const qstashToken = process.env.QSTASH_TOKEN;
  const workerSecret =
    process.env.AGENTREMIT_WORKER_SECRET ?? process.env.CRON_SECRET;
  const qstashUrl = process.env.QSTASH_URL ?? DEFAULT_QSTASH_URL;
  const destination = process.env.AGENTREMIT_WORKER_URL ?? DEFAULT_DESTINATION;
  const cron = process.env.QSTASH_CRON ?? DEFAULT_CRON;
  const scheduleId = process.env.QSTASH_SCHEDULE_ID ?? DEFAULT_SCHEDULE_ID;

  if (!qstashToken) {
    throw new Error("QSTASH_TOKEN is required.");
  }

  if (!workerSecret) {
    throw new Error("AGENTREMIT_WORKER_SECRET or CRON_SECRET is required.");
  }

  const response = await fetch(
    `${qstashUrl.replace(/\/$/, "")}/v2/schedules/${destination}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        "Content-Type": "application/json",
        "Upstash-Cron": cron,
        "Upstash-Method": "POST",
        "Upstash-Retries": "3",
        "Upstash-Timeout": "30s",
        "Upstash-Schedule-Id": scheduleId,
        "Upstash-Forward-Authorization": `Bearer ${workerSecret}`,
      },
      body: "{}",
    },
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`QStash schedule failed with ${response.status}: ${body}`);
  }

  const parsed = JSON.parse(body) as { scheduleId?: string };

  console.log(
    JSON.stringify(
      {
        scheduleId: parsed.scheduleId ?? scheduleId,
        qstashUrl,
        destination,
        cron,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
