import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { registerAgentName, updateAgentStats } from "../lib/ens";
import { saveReceipt } from "../lib/storage";
import type { AgentConfig, RemittanceReceipt } from "../types";

dotenv.config({ path: ".env.local" });

const SUBNAME = "sends-ada-home";
const AGENT_ENS_NAME = `${SUBNAME}.agentremit.eth`;
const RECIPIENT_ADDRESS = "0xEE3eA6f858aE84dD6959f241DfC257a2f8fA3f53";
const DAY_MS = 24 * 60 * 60 * 1000;

type SeedOutput = {
  ensNames: string[];
  txHashes: string[];
  zeroGStorageKeys: string[];
  receipts: RemittanceReceipt[];
};

async function main() {
  const ownerAddress = getOwnerAddress();
  const config: AgentConfig = {
    ensName: AGENT_ENS_NAME,
    ownerAddress,
    recipientAddress: RECIPIENT_ADDRESS,
    amountUsdc: "100",
    targetRateNgn: 1610,
  };

  const ensName = await registerAgentName(SUBNAME, ownerAddress, config);
  console.log(`Registered ENS agent: ${ensName}`);

  const receipts = buildSeedReceipts(ensName, ownerAddress);
  const zeroGStorageKeys: string[] = [];

  for (const receipt of receipts) {
    await saveReceipt(receipt);
    await updateAgentStats(ensName, receipt);
    zeroGStorageKeys.push(getReceiptStorageKey(receipt));
    console.log(
      `Seeded ${receipt.amountUsdc} USDC receipt: ${receipt.uniswapTxHash}`,
    );
  }

  const output: SeedOutput = {
    ensNames: [ensName],
    txHashes: receipts.map((receipt) => receipt.uniswapTxHash),
    zeroGStorageKeys,
    receipts,
  };

  const outputPath = join(process.cwd(), "scripts", "seed-output.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote seed output to ${outputPath}`);
}

function buildSeedReceipts(
  agentEnsName: string,
  senderAddress: string,
): RemittanceReceipt[] {
  const now = Date.now();
  const seeds = [
    { amountUsdc: "50", effectiveRateNgn: 1584, daysAgo: 3 },
    { amountUsdc: "100", effectiveRateNgn: 1612, daysAgo: 2 },
    { amountUsdc: "200", effectiveRateNgn: 1620, daysAgo: 1 },
  ];

  return seeds.map((seed, index) => {
    const timestamp = now - seed.daysAgo * DAY_MS;
    const uniswapTxHash = fakeTxHash(`${agentEnsName}:${seed.amountUsdc}:${timestamp}`);
    const keeperJobId = `kh_demo_${String(index + 1).padStart(3, "0")}`;

    return {
      id: `${agentEnsName}:${timestamp}`,
      agentEnsName,
      senderAddress,
      recipientAddress: RECIPIENT_ADDRESS,
      amountUsdc: seed.amountUsdc,
      effectiveRateNgn: seed.effectiveRateNgn,
      keeperJobId,
      uniswapTxHash,
      timestamp,
      status: "success",
    };
  });
}

function getOwnerAddress(): `0x${string}` {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is required to seed the demo environment.");
  }

  return privateKeyToAccount(
    privateKey.startsWith("0x")
      ? (privateKey as `0x${string}`)
      : (`0x${privateKey}` as `0x${string}`),
  ).address;
}

function getReceiptStorageKey(receipt: RemittanceReceipt): string {
  return `agentremit:receipts:${receipt.agentEnsName}:${receipt.timestamp}`;
}

function fakeTxHash(input: string): `0x${string}` {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
