import { fetchReceiptHistory } from "@/lib/storage";

export async function ReceiptList() {
  const receipts = await fetchReceiptHistory(
    process.env.NEXT_PUBLIC_AGENT_ENS_NAME,
  );

  return (
    <section className="rounded-md border border-[#d8dee4] bg-white shadow-sm">
      <div className="border-b border-[#d8dee4] p-5">
        <p className="text-sm font-medium text-[#57606a]">0G receipts</p>
        <h2 className="mt-1 text-2xl font-semibold">Receipt history</h2>
      </div>

      {receipts.length === 0 ? (
        <div className="p-5 text-sm leading-6 text-[#57606a]">
          No receipts found for the configured agent.
        </div>
      ) : (
        <ul className="divide-y divide-[#d8dee4]">
          {receipts.map((receipt) => (
            <li
              key={receipt.id}
              className="grid gap-3 p-5 text-sm md:grid-cols-[1.4fr_1fr_1fr_auto]"
            >
              <span className="font-medium text-[#24292f]">{receipt.id}</span>
              <span className="text-[#57606a]">
                {receipt.amountUsdc} USDC
              </span>
              <span className="text-[#57606a]">
                {new Date(receipt.timestamp).toLocaleString()}
              </span>
              <span className="rounded-md bg-[#ddf4ff] px-2 py-1 text-xs font-semibold uppercase text-[#0969da]">
                {receipt.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
