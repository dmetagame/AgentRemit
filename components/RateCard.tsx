import { getNgnUsdcRate } from "@/lib/rates";

export async function RateCard() {
  const rate = await getNgnUsdcRate();

  return (
    <section className="rounded-md border border-[#d8dee4] bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[#57606a]">USDC/NGN rate</p>
      <div className="mt-4 flex items-end gap-2">
        <span className="text-4xl font-semibold">
          {rate.rate.toLocaleString("en-NG", {
            maximumFractionDigits: 2,
          })}
        </span>
        <span className="pb-1 text-sm text-[#57606a]">NGN per USDC</span>
      </div>
      <div className="mt-5 grid gap-3 text-sm text-[#57606a] sm:grid-cols-2">
        <div className="rounded-md bg-[#f6f8fa] p-3">
          <p className="font-medium text-[#24292f]">Source</p>
          <p className="mt-1">{rate.source}</p>
        </div>
        <div className="rounded-md bg-[#f6f8fa] p-3">
          <p className="font-medium text-[#24292f]">Updated</p>
          <p className="mt-1">{new Date(rate.asOf).toLocaleString()}</p>
        </div>
      </div>
    </section>
  );
}
