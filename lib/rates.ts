import { EventEmitter } from "node:events";
import type { RateQuote } from "@/types";

const FALLBACK_NGN_PER_USDC = 1500;
const DEFAULT_WATCH_INTERVAL_MS = 30_000;

interface ExchangeRateResponse {
  conversion_rate?: number;
  result?: string;
}

interface OpenExchangeRateResponse {
  result?: string;
  rates?: {
    NGN?: number;
  };
  time_last_update_utc?: string;
}

function makeRateQuote(rate: number, source: string): RateQuote {
  return {
    pair: "USDC/NGN",
    base: "USDC",
    quote: "NGN",
    rate,
    inverseRate: 1 / rate,
    source,
    asOf: new Date().toISOString(),
  };
}

export async function getNgnUsdcRate(): Promise<RateQuote> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;

  if (apiKey) {
    const keyedRate = await getKeyedExchangeRate(apiKey);

    if (keyedRate) {
      return keyedRate;
    }
  }

  const openRate =
    process.env.AGENTREMIT_DISABLE_OPEN_RATE_PROVIDER === "true"
      ? null
      : await getOpenExchangeRate();

  if (openRate) {
    return openRate;
  }

  return makeRateQuote(FALLBACK_NGN_PER_USDC, "fallback");
}

async function getKeyedExchangeRate(apiKey: string): Promise<RateQuote | null> {
  try {
    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/NGN`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`Rate provider returned ${response.status}`);
    }

    const payload = (await response.json()) as ExchangeRateResponse;
    const rate = payload.conversion_rate;

    if (!rate || payload.result === "error") {
      throw new Error("Rate provider did not return a usable NGN rate");
    }

    return makeRateQuote(rate, "exchangerate-api");
  } catch {
    return null;
  }
}

async function getOpenExchangeRate(): Promise<RateQuote | null> {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Open rate provider returned ${response.status}`);
    }

    const payload = (await response.json()) as OpenExchangeRateResponse;
    const rate = payload.rates?.NGN;

    if (payload.result !== "success" || !rate || !Number.isFinite(rate)) {
      throw new Error("Open rate provider did not return a usable NGN rate");
    }

    return {
      ...makeRateQuote(rate, "open-er-api"),
      asOf: payload.time_last_update_utc
        ? new Date(payload.time_last_update_utc).toISOString()
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export type RateWatcher = EventEmitter & {
  stop: () => void;
  isActive: () => boolean;
};

export function watchRate(
  targetRateNgn: number,
  intervalMs = DEFAULT_WATCH_INTERVAL_MS,
): RateWatcher {
  let isActive = true;
  let isChecking = false;
  let timer: NodeJS.Timeout | null = null;
  const watcher = new EventEmitter() as RateWatcher;

  async function checkRate() {
    if (!isActive || isChecking) {
      return;
    }

    isChecking = true;

    try {
      const rate = await getNgnUsdcRate();
      watcher.emit("rate_update", rate);

      if (!isExecutableRate(rate)) {
        watcher.emit(
          "watcher_error",
          new Error("Live rate unavailable; refusing to execute on fallback rate."),
        );
        return;
      }

      if (rate.rate >= targetRateNgn) {
        watcher.emit("threshold_hit", rate);
      }
    } catch (error) {
      watcher.emit("watcher_error", error);
    } finally {
      isChecking = false;
    }
  }

  watcher.stop = () => {
    isActive = false;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  watcher.isActive = () => isActive;

  timer = setInterval(checkRate, intervalMs);
  setTimeout(checkRate, 0);

  return watcher;
}

export function isExecutableRate(rate: RateQuote): boolean {
  return rate.source !== "fallback" || allowFallbackRateExecution();
}

function allowFallbackRateExecution(): boolean {
  const keeperMode = process.env.KEEPERHUB_MODE?.toLowerCase();

  return (
    process.env.AGENTREMIT_ALLOW_FALLBACK_RATE_EXECUTION === "true" ||
    keeperMode === "mock" ||
    keeperMode === "dev" ||
    keeperMode === "local"
  );
}
