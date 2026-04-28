"use client";

import { useMemo, useState } from "react";

type RegisterResponse = {
  ensName?: string;
  profile?: {
    ownerAddress: string;
    recipientAddress: string;
    amountUsdc: string;
    targetRateNgn: number;
    totalSent: string;
    txCount: number;
    lastActive: string;
  };
  error?: string;
};

export function AgentRegistration() {
  const [recipientName, setRecipientName] = useState("Ada");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amountUsdc, setAmountUsdc] = useState("100");
  const [targetRateNgn, setTargetRateNgn] = useState("1500");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RegisterResponse | null>(null);

  const previewName = useMemo(
    () => `${generateAgentNamePreview(recipientName)}.agentremit.eth`,
    [recipientName],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const response = await fetch("/api/ens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipientName,
          recipientAddress,
          amountUsdc,
          targetRateNgn: Number(targetRateNgn),
        }),
      });
      const payload = (await response.json()) as RegisterResponse;

      setResult(payload);
    } catch (error) {
      setResult({
        error:
          error instanceof Error
            ? error.message
            : "Unable to submit ENS registration.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-md border border-[#d8dee4] bg-white shadow-sm">
      <div className="border-b border-[#d8dee4] p-5">
        <p className="text-sm font-medium text-[#57606a]">ENS agent</p>
        <h2 className="mt-1 text-2xl font-semibold">Register remittance name</h2>
      </div>

      <form className="grid gap-4 p-5 lg:grid-cols-2" onSubmit={submit}>
        <label className="flex flex-col gap-2 text-sm font-medium text-[#24292f]">
          Recipient name
          <input
            className="h-10 rounded-md border border-[#d0d7de] px-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium text-[#24292f]">
          Recipient address
          <input
            className="h-10 rounded-md border border-[#d0d7de] px-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
            placeholder="0x..."
            value={recipientAddress}
            onChange={(event) => setRecipientAddress(event.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium text-[#24292f]">
          Amount USDC
          <input
            className="h-10 rounded-md border border-[#d0d7de] px-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
            inputMode="decimal"
            value={amountUsdc}
            onChange={(event) => setAmountUsdc(event.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium text-[#24292f]">
          Target NGN rate
          <input
            className="h-10 rounded-md border border-[#d0d7de] px-3 text-sm font-normal outline-none transition focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
            inputMode="numeric"
            value={targetRateNgn}
            onChange={(event) => setTargetRateNgn(event.target.value)}
            required
          />
        </label>

        <div className="rounded-md bg-[#f6f8fa] p-3 text-sm text-[#57606a] lg:col-span-2">
          <span className="font-medium text-[#24292f]">Preview:</span>{" "}
          {previewName}
        </div>

        <div className="flex flex-col gap-3 lg:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-[#57606a]">
            Registration writes the subname and initial profile records on
            Sepolia.
          </p>
          <button
            type="submit"
            className="h-10 rounded-md bg-[#0969da] px-4 text-sm font-semibold text-white transition hover:bg-[#075ebf] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
          >
            {pending ? "Registering" : "Register agent"}
          </button>
        </div>
      </form>

      {result ? (
        <div className="border-t border-[#d8dee4] p-5">
          {result.error ? (
            <p className="rounded-md border border-[#ffebe9] bg-[#fff1f1] p-3 text-sm text-[#cf222e]">
              {result.error}
            </p>
          ) : (
            <div className="rounded-md border border-[#aceebb] bg-[#f0fff4] p-3 text-sm text-[#1a7f37]">
              <p className="font-semibold">{result.ensName}</p>
              <p className="mt-1">
                Registered with target rate{" "}
                {result.profile?.targetRateNgn.toLocaleString("en-NG")} NGN.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function generateAgentNamePreview(recipientName: string): string {
  const label = recipientName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `sends-${label || "recipient"}-home`;
}
