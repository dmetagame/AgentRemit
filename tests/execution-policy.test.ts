import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRemittanceExecutionAllowed,
  getExecutionPolicy,
} from "../lib/execution-policy";

const OWNER = "0x202228fDCC2EB6013F1B79D23bDB29C5C00D0079";
const RECIPIENT = "0xEE3eA6f858aE84dD6959f241DfC257a2f8fA3f53";

test("mock KeeperHub mode allows execution without live credentials", () => {
  withEnv(
    {
      KEEPERHUB_MODE: "mock",
      KEEPERHUB_API_KEY: "",
      AGENTREMIT_ENABLE_LIVE_EXECUTION: "",
      AGENTREMIT_MAX_LIVE_USDC: "",
      AGENTREMIT_EXECUTION_OWNER_ALLOWLIST: "",
    },
    () => {
      const policy = getExecutionPolicy({
        ownerAddress: OWNER,
        amountUsdc: "5",
      });

      assert.equal(policy.mode, "mock");
      assert.equal(policy.enabled, true);
      assert.doesNotThrow(() =>
        assertRemittanceExecutionAllowed({
          agentEnsName: "sends-test-home.agentremit.0g",
          ownerAddress: OWNER,
          recipientAddress: RECIPIENT,
          targetRate: 1600,
          amountUsdc: "5",
        }),
      );
    },
  );
});

test("live KeeperHub execution is disabled unless the explicit flag is set", () => {
  withEnv(
    {
      KEEPERHUB_MODE: "",
      KEEPERHUB_API_KEY: "keeper-test-key",
      AGENTREMIT_ENABLE_LIVE_EXECUTION: "",
      AGENTREMIT_MAX_LIVE_USDC: "10",
      AGENTREMIT_EXECUTION_OWNER_ALLOWLIST: OWNER,
    },
    () => {
      const policy = getExecutionPolicy({
        ownerAddress: OWNER,
        amountUsdc: "5",
      });

      assert.equal(policy.mode, "disabled");
      assert.match(policy.reason ?? "", /AGENTREMIT_ENABLE_LIVE_EXECUTION/);
    },
  );
});

test("live KeeperHub execution requires an amount cap and owner allowlist", () => {
  withEnv(
    {
      KEEPERHUB_MODE: "",
      KEEPERHUB_API_KEY: "keeper-test-key",
      AGENTREMIT_ENABLE_LIVE_EXECUTION: "true",
      AGENTREMIT_MAX_LIVE_USDC: "",
      AGENTREMIT_EXECUTION_OWNER_ALLOWLIST: "",
    },
    () => {
      assert.match(
        getExecutionPolicy({ ownerAddress: OWNER, amountUsdc: "5" }).reason ??
          "",
        /AGENTREMIT_MAX_LIVE_USDC/,
      );

      process.env.AGENTREMIT_MAX_LIVE_USDC = "10";

      assert.match(
        getExecutionPolicy({ ownerAddress: OWNER, amountUsdc: "5" }).reason ??
          "",
        /AGENTREMIT_EXECUTION_OWNER_ALLOWLIST/,
      );
    },
  );
});

test("live KeeperHub execution enforces owner allowlist and amount cap", () => {
  withEnv(
    {
      KEEPERHUB_MODE: "",
      KEEPERHUB_API_KEY: "keeper-test-key",
      AGENTREMIT_ENABLE_LIVE_EXECUTION: "true",
      AGENTREMIT_MAX_LIVE_USDC: "10",
      AGENTREMIT_EXECUTION_OWNER_ALLOWLIST: OWNER,
    },
    () => {
      assert.equal(
        getExecutionPolicy({ ownerAddress: OWNER, amountUsdc: "5" }).enabled,
        true,
      );
      assert.match(
        getExecutionPolicy({
          ownerAddress: "0x0000000000000000000000000000000000000001",
          amountUsdc: "5",
        }).reason ?? "",
        /allowlist/,
      );
      assert.match(
        getExecutionPolicy({ ownerAddress: OWNER, amountUsdc: "11" }).reason ??
          "",
        /cap/,
      );
    },
  );
});

function withEnv(
  values: Record<string, string>,
  run: () => void,
): void {
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

    run();
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
