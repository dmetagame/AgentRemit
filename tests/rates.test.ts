import test from "node:test";
import assert from "node:assert/strict";
import { getNgnUsdcRate, isExecutableRate } from "../lib/rates";

test("fallback FX rate is display-only by default", async () => {
  await withEnv(
    {
      EXCHANGE_RATE_API_KEY: "",
      KEEPERHUB_MODE: "",
      AGENTREMIT_ALLOW_FALLBACK_RATE_EXECUTION: "",
    },
    async () => {
      const quote = await getNgnUsdcRate();

      assert.equal(quote.source, "fallback");
      assert.equal(quote.rate, 1500);
      assert.equal(isExecutableRate(quote), false);
    },
  );
});

test("fallback FX rate is executable only in explicit mock/local mode", async () => {
  await withEnv(
    {
      EXCHANGE_RATE_API_KEY: "",
      KEEPERHUB_MODE: "mock",
      AGENTREMIT_ALLOW_FALLBACK_RATE_EXECUTION: "",
    },
    async () => {
      const quote = await getNgnUsdcRate();

      assert.equal(quote.source, "fallback");
      assert.equal(isExecutableRate(quote), true);
    },
  );
});

async function withEnv(
  values: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }

    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
