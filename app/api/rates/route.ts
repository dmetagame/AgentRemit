import { NextResponse } from "next/server";
import { getNgnUsdcRate, isExecutableRate } from "@/lib/rates";

export const dynamic = "force-dynamic";

export async function GET() {
  const quote = await getNgnUsdcRate();

  return NextResponse.json({
    ...quote,
    executable: isExecutableRate(quote),
    fallback: quote.source === "fallback",
  });
}
