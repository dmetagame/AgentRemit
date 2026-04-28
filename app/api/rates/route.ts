import { NextResponse } from "next/server";
import { getNgnUsdcRate } from "@/lib/rates";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getNgnUsdcRate());
}
