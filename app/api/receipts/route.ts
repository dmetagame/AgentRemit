import { NextResponse } from "next/server";
import { getAgentReceipts } from "@/lib/agent-job-store";
import { getReceiptHistory } from "@/lib/storage";
import type { RemittanceReceipt } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentEnsName = searchParams.get("agent");

  if (!agentEnsName) {
    return NextResponse.json(
      { error: "Missing required agent query parameter." },
      { status: 400 },
    );
  }

  try {
    const receipts = mergeReceipts(
      await getReceiptHistory(agentEnsName),
      await getAgentReceipts(agentEnsName),
    );

    return NextResponse.json({ receipts });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch receipt history from 0G.",
      },
      { status: 502 },
    );
  }
}

function mergeReceipts(
  left: RemittanceReceipt[],
  right: RemittanceReceipt[],
): RemittanceReceipt[] {
  const receipts = new Map<string, RemittanceReceipt>();

  left.forEach((receipt) => receipts.set(receipt.id, receipt));
  right.forEach((receipt) => receipts.set(receipt.id, receipt));

  return Array.from(receipts.values()).sort((a, b) => b.timestamp - a.timestamp);
}
