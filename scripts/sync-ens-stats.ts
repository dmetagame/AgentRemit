import dotenv from "dotenv";
import { getAgentProfile, updateAgentStats } from "../lib/ens";
import { getReceiptHistory } from "../lib/storage";
import type { RemittanceReceipt } from "../types";

dotenv.config({ path: ".env.local" });

const agentEnsName = process.argv[2] ?? "sends-ada-home.agentremit.eth";

async function main() {
  const before = await getAgentProfile(agentEnsName);
  const receipts = await getReceiptHistory(agentEnsName);
  const stats = computeStats(receipts);

  console.log(
    JSON.stringify(
      {
        agentEnsName,
        before: {
          totalSent: before.totalSent,
          txCount: before.txCount,
          lastActive: before.lastActive,
        },
        computed: stats,
        receiptCount: receipts.length,
      },
      null,
      2,
    ),
  );

  await updateAgentStats(agentEnsName, stats);

  const after = await getAgentProfile(agentEnsName);

  console.log(
    JSON.stringify(
      {
        agentEnsName,
        after: {
          totalSent: after.totalSent,
          txCount: after.txCount,
          lastActive: after.lastActive,
        },
      },
      null,
      2,
    ),
  );
}

function computeStats(receipts: RemittanceReceipt[]) {
  const successfulReceipts = receipts.filter(
    (receipt) => receipt.status === "success",
  );
  const totalSent = successfulReceipts
    .reduce((total, receipt) => total + Number.parseFloat(receipt.amountUsdc), 0)
    .toFixed(2);
  const txCount = successfulReceipts.length;
  const lastTimestamp = successfulReceipts.reduce(
    (latest, receipt) => Math.max(latest, receipt.timestamp),
    0,
  );
  const lastActive =
    lastTimestamp > 0 ? new Date(normalizeTimestamp(lastTimestamp)).toISOString() : "never";

  return {
    totalSent,
    txCount,
    lastActive,
  };
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
