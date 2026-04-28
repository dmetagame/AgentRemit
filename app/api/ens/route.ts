import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  generateAgentName,
  getAgentProfile,
  registerAgentName,
  resolveEnsName,
  updateAgentStats,
} from "@/lib/ens";
import type { AgentConfig, RemittanceReceipt } from "@/types";

export const dynamic = "force-dynamic";

type RegisterAgentBody = {
  subname?: string;
  recipientName?: string;
  ownerAddress?: string;
  recipientAddress?: string;
  amountUsdc?: string;
  targetRateNgn?: number;
};

type UpdateStatsBody = {
  ensName?: string;
  receipt?: RemittanceReceipt;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resolveName = searchParams.get("resolve");
  const ensName = searchParams.get("name");

  if (resolveName) {
    try {
      const address = await resolveEnsName(resolveName);

      if (!address) {
        return NextResponse.json(
          { error: "ENS name did not resolve.", address: null },
          { status: 404 },
        );
      }

      return NextResponse.json({ address });
    } catch (error) {
      return jsonError(error, 502);
    }
  }

  if (!ensName) {
    return NextResponse.json(
      { error: "Missing required name query parameter." },
      { status: 400 },
    );
  }

  try {
    const profile = await getAgentProfile(ensName);

    return NextResponse.json({ profile });
  } catch (error) {
    return jsonError(error, 502);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RegisterAgentBody;
  const ownerAddress = body.ownerAddress ?? getDefaultOwnerAddress();
  const subname =
    body.subname ??
    (body.recipientName ? generateAgentName(body.recipientName) : undefined);

  if (!subname) {
    return NextResponse.json(
      { error: "Provide subname or recipientName." },
      { status: 400 },
    );
  }

  if (!body.recipientAddress || !body.amountUsdc || !body.targetRateNgn) {
    return NextResponse.json(
      {
        error:
          "recipientAddress, amountUsdc, and targetRateNgn are required.",
      },
      { status: 400 },
    );
  }

  if (!ownerAddress) {
    return NextResponse.json(
      { error: "PRIVATE_KEY is required to derive the owner address." },
      { status: 500 },
    );
  }

  const config: AgentConfig = {
    ensName: "",
    ownerAddress,
    recipientAddress: body.recipientAddress,
    amountUsdc: body.amountUsdc,
    targetRateNgn: body.targetRateNgn,
  };

  try {
    const ensName = await registerAgentName(subname, ownerAddress, config);
    const profile = await getAgentProfile(ensName);

    return NextResponse.json({ ensName, profile }, { status: 201 });
  } catch (error) {
    return jsonError(error, 502);
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as UpdateStatsBody;

  if (!body.ensName || !body.receipt) {
    return NextResponse.json(
      { error: "ensName and receipt are required." },
      { status: 400 },
    );
  }

  try {
    await updateAgentStats(body.ensName, body.receipt);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, 502);
  }
}

function getDefaultOwnerAddress() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    return undefined;
  }

  return privateKeyToAccount(
    privateKey.startsWith("0x") ? `0x${privateKey.slice(2)}` : `0x${privateKey}`,
  ).address;
}

function jsonError(error: unknown, status: number) {
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "ENS operation failed unexpectedly.",
    },
    { status },
  );
}
