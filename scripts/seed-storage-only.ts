import { createHash, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import type { RemittanceReceipt } from "../types";

dotenv.config({ path: ".env.local" });

const AGENT_ENS_NAME = "sends-ada-home.agentremit.eth";
const DAY_MS = 24 * 60 * 60 * 1000;
const SENDER_ADDRESS = "0xD3eed2f7dcED5fbc96Fb1a0FC058C540D50b4f80";
const RECIPIENT_ADDRESS = "0xEE3eA6f858aE84dD6959f241DfC257a2f8fA3f53";

async function main() {
  const { saveReceipt } = await import("../lib/storage");
  const receipts = buildReceipts();

  for (const receipt of receipts) {
    const result = await saveReceipt(receipt);

    if (result.persistedToZeroG) {
      console.log(
        `Seeded ${receipt.amountUsdc} USDC receipt rootHash: ${result.rootHash}`,
      );
      continue;
    }

    console.error(
      `Failed to upload ${receipt.amountUsdc} USDC receipt: ${result.error}`,
    );
  }
}

function buildReceipts(): RemittanceReceipt[] {
  const now = Date.now();
  const seeds = [
    {
      amountUsdc: "50",
      effectiveRateNgn: 1580,
      timestamp: now - 3 * DAY_MS,
    },
    {
      amountUsdc: "100",
      effectiveRateNgn: 1595,
      timestamp: now - 2 * DAY_MS,
    },
    {
      amountUsdc: "200",
      effectiveRateNgn: 1612,
      timestamp: now - DAY_MS,
    },
  ];

  return seeds.map((seed, index) => ({
    id: randomUUID(),
    agentEnsName: AGENT_ENS_NAME,
    senderAddress: SENDER_ADDRESS,
    recipientAddress: RECIPIENT_ADDRESS,
    amountUsdc: seed.amountUsdc,
    effectiveRateNgn: seed.effectiveRateNgn,
    keeperJobId: `kh_storage_only_${String(index + 1).padStart(3, "0")}`,
    uniswapTxHash: fakeTxHash(`${seed.amountUsdc}:${seed.timestamp}`),
    timestamp: seed.timestamp,
    status: "success",
  }));
}

function fakeTxHash(input: string): `0x${string}` {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
