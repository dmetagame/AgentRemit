import { NextResponse } from "next/server";
import {
  AuthError,
  addressesEqual,
  authErrorResponse,
  verifySignedAction,
} from "@/lib/auth";
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
  const requestBody = await request.json().catch(() => ({}));

  try {
    const { payload: body, signerAddress } =
      await verifySignedAction<RegisterAgentBody>(requestBody, "ens:register");
    const ownerAddress = body.ownerAddress ?? signerAddress;
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

    if (!addressesEqual(ownerAddress, signerAddress)) {
      return NextResponse.json(
        { error: "Signed wallet must match ownerAddress." },
        { status: 403 },
      );
    }

    const config: AgentConfig = {
      ensName: "",
      ownerAddress,
      recipientAddress: body.recipientAddress,
      amountUsdc: body.amountUsdc,
      targetRateNgn: body.targetRateNgn,
    };

    const ensName = await registerAgentName(subname, ownerAddress, config);
    const profile = await getAgentProfile(ensName);

    return NextResponse.json({ ensName, profile }, { status: 201 });
  } catch (error) {
    if (isAuthLikeError(error)) {
      return authErrorResponse(error);
    }

    return jsonError(error, 502);
  }
}

export async function PATCH(request: Request) {
  const requestBody = await request.json().catch(() => ({}));

  try {
    const { payload: body, signerAddress } =
      await verifySignedAction<UpdateStatsBody>(
        requestBody,
        "ens:update_stats",
      );

    if (!body.ensName || !body.receipt) {
      return NextResponse.json(
        { error: "ensName and receipt are required." },
        { status: 400 },
      );
    }

    if (!addressesEqual(body.receipt.senderAddress, signerAddress)) {
      return NextResponse.json(
        { error: "Signed wallet must match receipt senderAddress." },
        { status: 403 },
      );
    }

    const profile = await getAgentProfile(body.ensName);

    if (!addressesEqual(profile.ownerAddress, signerAddress)) {
      return NextResponse.json(
        { error: "Signed wallet must own the ENS agent profile." },
        { status: 403 },
      );
    }

    await updateAgentStats(body.ensName, body.receipt);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthLikeError(error)) {
      return authErrorResponse(error);
    }

    return jsonError(error, 502);
  }
}

function isAuthLikeError(error: unknown): boolean {
  return error instanceof AuthError;
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
