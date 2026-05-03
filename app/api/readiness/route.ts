import { NextResponse } from "next/server";
import { getRuntimeReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getRuntimeReadiness());
}
