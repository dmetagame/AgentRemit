"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import type { AgentConfig } from "@/types";

type SetupFormProps = {
  onAgentStarted: (
    config: AgentConfig,
    eventStream?: ReadableStream<Uint8Array> | null,
  ) => void;
};

type RateResponse = {
  rate?: number;
};

type ResolveResponse = {
  address?: string | null;
  error?: string;
};

export function SetupForm({ onAgentStarted }: SetupFormProps) {
  const { address: ownerAddress } = useAccount();
  const [name, setName] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolverState, setResolverState] = useState<
    "idle" | "loading" | "resolved" | "error"
  >("idle");
  const [amountUsdc, setAmountUsdc] = useState("");
  const [targetRateNgn, setTargetRateNgn] = useState("");
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const subname = useMemo(() => generateAgentSubname(name), [name]);
  const generatedEnsName = `${subname}.agentremit.eth`;
  const trimmedRecipient = recipientInput.trim();
  const isEnsRecipient = trimmedRecipient.toLowerCase().endsWith(".eth");
  const recipientAddress = isEnsRecipient ? resolvedAddress : trimmedRecipient;
  const amountNumber = Number(amountUsdc);
  const targetRateNumber = Number(targetRateNgn);
  const canSubmit =
    Boolean(ownerAddress) &&
    name.trim().length > 0 &&
    Boolean(recipientAddress && isAddress(recipientAddress)) &&
    Number.isFinite(amountNumber) &&
    amountNumber >= 1 &&
    Number.isInteger(amountNumber) &&
    Number.isFinite(targetRateNumber) &&
    targetRateNumber > 0 &&
    resolverState !== "loading" &&
    !isSubmitting;

  useEffect(() => {
    let cancelled = false;

    async function loadRate() {
      try {
        const response = await fetch("/api/rates", { cache: "no-store" });
        const payload = (await response.json()) as RateResponse;

        if (!cancelled && typeof payload.rate === "number") {
          setCurrentRate(payload.rate);
        }
      } catch {
        if (!cancelled) {
          setCurrentRate(null);
        }
      }
    }

    void loadRate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nameToResolve = trimmedRecipient;

    setResolvedAddress(null);

    if (!nameToResolve.toLowerCase().endsWith(".eth")) {
      setResolverState("idle");
      return;
    }

    setResolverState("loading");
    const abortController = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/ens?resolve=${encodeURIComponent(nameToResolve)}`,
          { signal: abortController.signal },
        );
        const payload = (await response.json()) as ResolveResponse;

        if (!response.ok || !payload.address || !isAddress(payload.address)) {
          throw new Error(payload.error ?? "Unable to resolve name.");
        }

        setResolvedAddress(payload.address);
        setResolverState("resolved");
      } catch {
        if (!abortController.signal.aborted) {
          setResolvedAddress(null);
          setResolverState("error");
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [trimmedRecipient]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || !ownerAddress || !recipientAddress) {
      return;
    }

    const config: AgentConfig = {
      ensName: generatedEnsName,
      ownerAddress,
      recipientAddress,
      amountUsdc: amountUsdc.trim(),
      targetRateNgn: targetRateNumber,
    };

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Unable to start agent.");
      }

      onAgentStarted(config, response.body);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Unable to start agent.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="rounded-md border border-[#d8dee4] bg-white p-6 shadow-sm"
      onSubmit={submit}
    >
      <div className="grid gap-6">
        <label className="grid gap-2 text-sm font-medium text-[#24292f]">
          Your name
          <input
            className="h-11 rounded-md border border-[#d0d7de] px-3 text-sm font-normal text-[#101418] outline-none transition placeholder:text-[#8c959f] focus:border-[#1a7f37] focus:ring-2 focus:ring-[#1a7f37]/20"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
          <span className="font-mono text-xs font-normal text-[#6e7781]">
            {generatedEnsName}
          </span>
        </label>

        <label className="grid gap-2 text-sm font-medium text-[#24292f]">
          Recipient wallet address
          <input
            className="h-11 rounded-md border border-[#d0d7de] px-3 text-sm font-normal text-[#101418] outline-none transition placeholder:text-[#8c959f] focus:border-[#1a7f37] focus:ring-2 focus:ring-[#1a7f37]/20"
            placeholder="0x..."
            value={recipientInput}
            onChange={(event) => setRecipientInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {isEnsRecipient ? (
            <span className={resolverTextClass(resolverState)}>
              {resolverState === "loading"
                ? "Resolving name..."
                : resolverState === "resolved" && resolvedAddress
                  ? `Resolved to ${truncateAddress(resolvedAddress)}`
                  : resolverState === "error"
                    ? "Name could not be resolved"
                    : "Enter a name ending in .eth"}
            </span>
          ) : null}
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-[#24292f]">
            Amount to send (USDC)
            <input
              className="h-11 rounded-md border border-[#d0d7de] px-3 text-sm font-normal text-[#101418] outline-none transition placeholder:text-[#8c959f] focus:border-[#1a7f37] focus:ring-2 focus:ring-[#1a7f37]/20"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amountUsdc}
              onChange={(event) => setAmountUsdc(event.target.value)}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-[#24292f]">
            Target NGN rate
            <input
              className="h-11 rounded-md border border-[#d0d7de] px-3 text-sm font-normal text-[#101418] outline-none transition placeholder:text-[#8c959f] focus:border-[#1a7f37] focus:ring-2 focus:ring-[#1a7f37]/20"
              type="number"
              min={1}
              inputMode="decimal"
              placeholder={
                currentRate
                  ? `Current: ${currentRate.toLocaleString("en-NG")} NGN/USDC`
                  : "Current live rate"
              }
              value={targetRateNgn}
              onChange={(event) => setTargetRateNgn(event.target.value)}
            />
            <span className="text-xs font-normal text-[#6e7781]">
              Agent fires when rate reaches this target
            </span>
          </label>
        </div>

        {submitError ? (
          <p className="rounded-md border border-[#ffebe9] bg-[#fff1f1] px-3 py-2 text-sm text-[#cf222e]">
            {submitError}
          </p>
        ) : null}

        <button
          type="submit"
          className="h-11 rounded-md bg-[#1a7f37] px-5 text-sm font-semibold text-white transition hover:bg-[#116329] disabled:cursor-not-allowed disabled:bg-[#94d3a2]"
          disabled={!canSubmit}
        >
          {isSubmitting ? "Deploying..." : "Deploy Agent"}
        </button>
      </div>
    </form>
  );
}

function generateAgentSubname(value: string): string {
  const label = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `sends-${label || "name"}-home`;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function resolverTextClass(state: "idle" | "loading" | "resolved" | "error") {
  const base = "text-xs font-normal";

  if (state === "resolved") {
    return `${base} text-[#1a7f37]`;
  }

  if (state === "error") {
    return `${base} text-[#cf222e]`;
  }

  return `${base} text-[#6e7781]`;
}
