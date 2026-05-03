import type { Address } from "viem";

export type RemittanceExecutionMeta = {
  agentEnsName: string;
  ownerAddress: string;
  recipientAddress: string;
  targetRate: number;
  amountUsdc: string;
};

export type ExecutionPolicy = {
  mode: "mock" | "live" | "disabled";
  enabled: boolean;
  keeperHubConfigured: boolean;
  liveExecutionEnabled: boolean;
  ownerAllowlistConfigured: boolean;
  ownerAllowed: boolean | null;
  maxAmountUsdc: number | null;
  reason: string | null;
};

const LIVE_EXECUTION_FLAG = "AGENTREMIT_ENABLE_LIVE_EXECUTION";
const MAX_LIVE_USDC_ENV = "AGENTREMIT_MAX_LIVE_USDC";
const OWNER_ALLOWLIST_ENV = "AGENTREMIT_EXECUTION_OWNER_ALLOWLIST";

export function getExecutionPolicy(
  meta?: Pick<RemittanceExecutionMeta, "ownerAddress" | "amountUsdc">,
): ExecutionPolicy {
  if (isMockKeeperHubMode()) {
    return {
      mode: "mock",
      enabled: true,
      keeperHubConfigured: Boolean(process.env.KEEPERHUB_API_KEY),
      liveExecutionEnabled: false,
      ownerAllowlistConfigured: false,
      ownerAllowed: true,
      maxAmountUsdc: null,
      reason: null,
    };
  }

  const keeperHubConfigured = Boolean(process.env.KEEPERHUB_API_KEY);
  const liveExecutionEnabled =
    process.env[LIVE_EXECUTION_FLAG]?.toLowerCase() === "true";
  const maxAmountUsdc = readPositiveNumber(process.env[MAX_LIVE_USDC_ENV]);
  const ownerAllowlist = readAddressList(process.env[OWNER_ALLOWLIST_ENV]);
  const ownerAllowlistConfigured = ownerAllowlist.length > 0;
  const ownerAllowed =
    meta?.ownerAddress && ownerAllowlistConfigured
      ? ownerAllowlist.includes(normalizeAddress(meta.ownerAddress))
      : ownerAllowlistConfigured
        ? null
        : false;
  const amountUsdc = meta?.amountUsdc ? Number(meta.amountUsdc) : null;
  const reason = readLiveExecutionBlocker({
    keeperHubConfigured,
    liveExecutionEnabled,
    maxAmountUsdc,
    ownerAllowlistConfigured,
    ownerAllowed,
    amountUsdc,
  });

  return {
    mode: reason ? "disabled" : "live",
    enabled: !reason,
    keeperHubConfigured,
    liveExecutionEnabled,
    ownerAllowlistConfigured,
    ownerAllowed,
    maxAmountUsdc,
    reason,
  };
}

export function assertRemittanceExecutionAllowed(
  meta: RemittanceExecutionMeta,
): void {
  const policy = getExecutionPolicy(meta);

  if (!policy.enabled) {
    throw new Error(`Live KeeperHub execution is disabled: ${policy.reason}`);
  }
}

export function isMockKeeperHubMode(): boolean {
  const mode = process.env.KEEPERHUB_MODE?.toLowerCase();

  return mode === "mock" || mode === "dev" || mode === "local";
}

function readLiveExecutionBlocker({
  keeperHubConfigured,
  liveExecutionEnabled,
  maxAmountUsdc,
  ownerAllowlistConfigured,
  ownerAllowed,
  amountUsdc,
}: {
  keeperHubConfigured: boolean;
  liveExecutionEnabled: boolean;
  maxAmountUsdc: number | null;
  ownerAllowlistConfigured: boolean;
  ownerAllowed: boolean | null;
  amountUsdc: number | null;
}): string | null {
  if (!keeperHubConfigured) {
    return "KEEPERHUB_API_KEY is not configured.";
  }

  if (!liveExecutionEnabled) {
    return `${LIVE_EXECUTION_FLAG}=true is required before server-funded execution can run.`;
  }

  if (!maxAmountUsdc) {
    return `${MAX_LIVE_USDC_ENV} must be set to a positive USDC cap.`;
  }

  if (!ownerAllowlistConfigured) {
    return `${OWNER_ALLOWLIST_ENV} must include the wallet addresses allowed to create live execution jobs.`;
  }

  if (ownerAllowed === false) {
    return "The signed owner wallet is not in the live execution allowlist.";
  }

  if (amountUsdc !== null) {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return "amountUsdc must be a positive number.";
    }

    if (amountUsdc > maxAmountUsdc) {
      return `amountUsdc exceeds the configured ${MAX_LIVE_USDC_ENV} cap.`;
    }
  }

  return null;
}

function readPositiveNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readAddressList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map(normalizeAddress);
}

function normalizeAddress(value: string): Address {
  return value.toLowerCase() as Address;
}
