import { NextResponse } from "next/server";
import { getReceiptHistory } from "@/lib/storage";

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
    const receipts = await getReceiptHistory(agentEnsName);

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
