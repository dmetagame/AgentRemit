"use client";

import { useEffect, useMemo, useState } from "react";
import type { RemittanceReceipt } from "@/types";

type ReceiptsTableProps = {
  agentEnsName: string;
  refreshKey?: number;
};

type ReceiptsResponse = {
  receipts?: RemittanceReceipt[];
  error?: string;
};

export function ReceiptsTable({ agentEnsName, refreshKey = 0 }: ReceiptsTableProps) {
  const [receipts, setReceipts] = useState<RemittanceReceipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const keeperHubExplorerBase = process.env.NEXT_PUBLIC_KEEPERHUB_EXPLORER_URL;
  const zeroGExplorerBase = process.env.NEXT_PUBLIC_ZEROG_EXPLORER_URL;
  const txExplorerBase = process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_URL;
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
  }, [agentEnsName, refreshKey]);

  return (
    <section className="agent-card overflow-hidden">
      <div className="agent-card-header px-5 py-4">
        <h2 className="text-sm font-semibold agent-heading">
          Transaction history
        </h2>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="px-5 py-10 text-center text-sm agent-muted">
            Loading transactions...
          </div>
        ) : error ? (
          <div className="px-5 py-10 text-center text-sm agent-danger">
            {error}
          </div>
        ) : sortedReceipts.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm agent-muted">
            No transactions yet — agent is watching rates.
          </div>
        ) : (
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="agent-table-head text-xs font-semibold uppercase">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Transfer</th>
                <th className="px-5 py-3">Recipient</th>
                <th className="px-5 py-3">Uniswap Quote</th>
                <th className="px-5 py-3">Execution</th>
                <th className="px-5 py-3">0G Receipt</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {sortedReceipts.map((receipt) => (
                <tr key={receipt.id} className="agent-table-row">
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    {formatDate(receipt.timestamp)}
                  </td>
                  <td className="min-w-[150px] px-5 py-4 text-[13px]">
                    <p className="font-semibold agent-heading">
                      {receipt.amountUsdc} USDC
                    </p>
                    <p className="mt-1 agent-muted">
                      ₦
                      {receipt.effectiveRateNgn.toLocaleString("en-NG", {
                        maximumFractionDigits: 0,
                      })}
                      /USDC
                    </p>
                    {receipt.amountInEth ? (
                      <p className="mt-1 agent-subtle">
                        Input {receipt.amountInEth} ETH
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] agent-muted">
                        {truncateAddress(receipt.recipientAddress)}
                      </span>
                      <button
                        type="button"
                        className="agent-button agent-button-secondary px-2 py-1 text-[11px]"
                        onClick={() => copyText(receipt.recipientAddress)}
                      >
                        Copy
                      </button>
                    </div>
                  </td>
                  <td className="min-w-[260px] px-5 py-4 text-[13px]">
                    <QuoteDetails receipt={receipt} />
                  </td>
                  <td className="min-w-[190px] px-5 py-4 text-[13px]">
                    <ExecutionDetails
                      receipt={receipt}
                      keeperHubExplorerBase={keeperHubExplorerBase}
                      txExplorerBase={txExplorerBase}
                    />
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[13px]">
                    <StorageProof
                      receipt={receipt}
                      zeroGExplorerBase={zeroGExplorerBase}
                    />
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

      <p className="border-t agent-divider px-5 py-3 text-[11px] agent-subtle">
        0G Storage proof is shown when a live root hash is available.
      </p>
    </section>
  );
}

function StorageProof({
  receipt,
  zeroGExplorerBase,
}: {
  receipt: RemittanceReceipt;
  zeroGExplorerBase?: string;
}) {
  if (receipt.demo || receipt.storageProvider === "demo") {
    return <span className="agent-subtle">demo seed</span>;
  }

  if (receipt.zeroGRootHash) {
    const label = truncateHash(receipt.zeroGRootHash);

    return (
      <div className="grid gap-1">
        {zeroGExplorerBase ? (
          <a
            className="font-medium agent-link"
            href={joinUrl(zeroGExplorerBase, receipt.zeroGRootHash)}
            target="_blank"
            rel="noreferrer"
            title={receipt.zeroGRootHash}
          >
            root {label}
          </a>
        ) : (
          <span className="font-mono agent-muted" title={receipt.zeroGRootHash}>
            root {label}
          </span>
        )}
        {receipt.zeroGTxHash ? (
          <span className="font-mono text-[11px] agent-subtle">
            tx {truncateHash(receipt.zeroGTxHash)}
          </span>
        ) : null}
      </div>
    );
  }

  if (receipt.storageProvider === "memory") {
    return <span className="agent-warning">memory fallback</span>;
  }

  return <span className="agent-subtle">no proof</span>;
}

function QuoteDetails({ receipt }: { receipt: RemittanceReceipt }) {
  const before = receipt.uniswapQuoteBefore;
  const after = receipt.uniswapQuoteAfter;
  const expected = receipt.expectedAmountOutUsdc ?? before?.expectedUsdc;
  const minimum = receipt.minimumAmountOutUsdc ?? before?.minimumOut;
  const source = receipt.uniswapQuoteSource ?? before?.source;
  const route = receipt.uniswapRoute ?? before?.route;

  return (
    <div className="grid gap-1.5">
      <p className="font-semibold agent-heading">
        {expected ? `${expected} USDC expected` : "Quote unavailable"}
      </p>
      {minimum ? (
        <p className="agent-muted">Min after slippage {minimum} USDC</p>
      ) : null}
      <p className="agent-muted">
        {source === "uniswap-api" ? "Uniswap API" : "Uniswap v3 contract"}
        {typeof receipt.slippageBps === "number"
          ? ` · ${formatBps(receipt.slippageBps)} slippage`
          : ""}
      </p>
      {route ? <p className="agent-subtle">{route}</p> : null}
      {after ? (
        <p className="agent-subtle">
          After confirmation quote {after.expectedUsdc} USDC
        </p>
      ) : null}
    </div>
  );
}

function ExecutionDetails({
  receipt,
  keeperHubExplorerBase,
  txExplorerBase,
}: {
  receipt: RemittanceReceipt;
  keeperHubExplorerBase?: string;
  txExplorerBase?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <HashLink
        label="Keeper"
        value={receipt.keeperJobId}
        baseUrl={keeperHubExplorerBase}
      />
      {receipt.uniswapTxHash ? (
        <HashLink
          label="Tx"
          value={receipt.uniswapTxHash}
          baseUrl={txExplorerBase}
        />
      ) : (
        <span className="agent-subtle">Tx pending</span>
      )}
      {receipt.executionStatus ? (
        <span className="agent-subtle">Keeper status {receipt.executionStatus}</span>
      ) : null}
    </div>
  );
}

function HashLink({
  label,
  value,
  baseUrl,
}: {
  label: string;
  value: string;
  baseUrl?: string;
}) {
  const renderedValue = value.length > 14 ? truncateHash(value) : value;

  return baseUrl ? (
    <a
      className="font-medium agent-link"
      href={joinUrl(baseUrl, value)}
      target="_blank"
      rel="noreferrer"
      title={value}
    >
      {label} {renderedValue}
    </a>
  ) : (
    <span className="font-mono agent-muted" title={value}>
      {label} {renderedValue}
    </span>
  );
}

function StatusBadge({ status }: { status: RemittanceReceipt["status"] }) {
  const isConfirmed = status === "success";

  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ${
        isConfirmed
          ? "bg-emerald-400/15 text-emerald-100"
          : "bg-rose-400/15 text-rose-100"
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

function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}
