import { EventEmitter } from "node:events";
import type { RateQuote } from "@/types";

const FALLBACK_NGN_PER_USDC = 1500;
const DEFAULT_WATCH_INTERVAL_MS = 30_000;

interface ExchangeRateResponse {
  conversion_rate?: number;
  result?: string;
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

  if (!apiKey) {
    return makeRateQuote(FALLBACK_NGN_PER_USDC, "fallback");
  }

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
    return makeRateQuote(FALLBACK_NGN_PER_USDC, "fallback");
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
