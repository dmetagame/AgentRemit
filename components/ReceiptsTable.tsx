"use client";

import { useEffect, useMemo, useState } from "react";
import type { RemittanceReceipt } from "@/types";

type ReceiptsTableProps = {
  agentEnsName: string;
};

type ReceiptsResponse = {
  receipts?: RemittanceReceipt[];
  error?: string;
};

export function ReceiptsTable({ agentEnsName }: ReceiptsTableProps) {
  const [receipts, setReceipts] = useState<RemittanceReceipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const keeperHubExplorerBase = process.env.NEXT_PUBLIC_KEEPERHUB_EXPLORER_URL;
  const zeroGExplorerBase = process.env.NEXT_PUBLIC_ZEROG_EXPLORER_URL;
  const sortedReceipts = useMemo(
    () => [...receipts].sort((a, b) => b.timestamp - a.timestamp),
    [receipts],
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadReceipts() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/receipts?agent=${encodeURIComponent(agentEnsName)}`,
          {
            cache: "no-store",
            signal: abortController.signal,
          },
        );
        const payload = (await response.json()) as ReceiptsResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load receipts.");
        }

        setReceipts(payload.receipts ?? []);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setError(
            error instanceof Error ? error.message : "Unable to load receipts.",
          );
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    if (agentEnsName) {
      void loadReceipts();
    } else {
      setReceipts([]);
      setIsLoading(false);
    }

    return () => abortController.abort();
  }, [agentEnsName]);

  return (
    <section className="rounded-md border border-[#d8dee4] bg-white shadow-sm">
      <div className="border-b border-[#d8dee4] px-5 py-4">
        <h2 className="text-sm font-semibold text-[#24292f]">
          Transaction history
        </h2>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-[#6e7781]">
            Loading transactions...
          </div>
        ) : error ? (
          <div className="px-5 py-10 text-center text-sm text-[#cf222e]">
            {error}
          </div>
        ) : sortedReceipts.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[#6e7781]">
            No transactions yet — agent is watching rates.
          </div>
        ) : (
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#d8dee4] bg-[#f6f8fa] text-xs font-semibold uppercase text-[#6e7781]">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Rate</th>
                <th className="px-5 py-3">Recipient</th>
                <th className="px-5 py-3">KeeperHub Job</th>
                <th className="px-5 py-3">0G Receipt</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d8dee4]">
              {sortedReceipts.map((receipt) => (
                <tr key={receipt.id} className="text-[#24292f]">
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    {formatDate(receipt.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    {receipt.amountUsdc} USDC
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    ₦
                    {receipt.effectiveRateNgn.toLocaleString("en-NG", {
                      maximumFractionDigits: 0,
                    })}
                    /USDC
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-[#57606a]">
                        {truncateAddress(receipt.recipientAddress)}
                      </span>
                      <button
                        type="button"
                        className="rounded-md border border-[#d8dee4] px-2 py-1 text-[11px] font-medium text-[#57606a] transition hover:bg-[#f6f8fa]"
                        onClick={() => copyText(receipt.recipientAddress)}
                      >
                        Copy
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    {keeperHubExplorerBase ? (
                      <a
                        className="font-medium text-[#0969da] hover:underline"
                        href={joinUrl(keeperHubExplorerBase, receipt.keeperJobId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {receipt.keeperJobId.slice(0, 8)}
                      </a>
                    ) : (
                      <span className="text-[#57606a]">
                        {receipt.keeperJobId.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    {zeroGExplorerBase ? (
                      <a
                        className="font-medium text-[#0969da] hover:underline"
                        href={joinUrl(
                          zeroGExplorerBase,
                          encodeURIComponent(getZeroGReceiptKey(receipt)),
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        view
                      </a>
                    ) : (
                      <span className="text-[#6e7781]">view</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <StatusBadge status={receipt.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="border-t border-[#d8dee4] px-5 py-3 text-[11px] text-[#6e7781]">
        Powered by 0G Storage
      </p>
    </section>
  );
}

function StatusBadge({ status }: { status: RemittanceReceipt["status"] }) {
  const isConfirmed = status === "success";

  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ${
        isConfirmed ? "bg-[#dafbe1] text-[#1a7f37]" : "bg-[#ffebe9] text-[#cf222e]"
      }`}
    >
      {isConfirmed ? "Confirmed" : "Failed"}
    </span>
  );
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(normalizeTimestamp(timestamp)));
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function getZeroGReceiptKey(receipt: RemittanceReceipt): string {
  return `agentremit:receipts:${receipt.agentEnsName}:${receipt.timestamp}`;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}
