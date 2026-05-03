import {
  requiresDurableAgentJobStore,
  usesDurableAgentJobStore,
} from "@/lib/agent-job-store";
import { getExecutionPolicy } from "@/lib/execution-policy";
import { getNgnUsdcRate, isExecutableRate } from "@/lib/rates";
import { getZeroGStorageReadiness } from "@/lib/storage";

export type RuntimeReadiness = {
  canDeploy: boolean;
  canExecuteLive: boolean;
  warnings: string[];
  jobStore: {
    durable: boolean;
    required: boolean;
  };
  rate: {
    source: string;
    executable: boolean;
    fallback: boolean;
  };
  execution: ReturnType<typeof getExecutionPolicy>;
  zeroG: ReturnType<typeof getZeroGStorageReadiness>;
  worker: {
    protected: boolean;
  };
};

export async function getRuntimeReadiness(): Promise<RuntimeReadiness> {
  const durable = usesDurableAgentJobStore();
  const durableRequired = requiresDurableAgentJobStore();
  const rate = await getNgnUsdcRate();
  const rateExecutable = isExecutableRate(rate);
  const execution = getExecutionPolicy();
  const zeroG = getZeroGStorageReadiness();
  const workerProtected = Boolean(
    process.env.AGENTREMIT_WORKER_SECRET ?? process.env.CRON_SECRET,
  );
  const warnings = buildWarnings({
    durable,
    durableRequired,
    rateSource: rate.source,
    rateExecutable,
    execution,
    zeroG,
    workerProtected,
  });

  return {
    canDeploy: durable || !durableRequired,
    canExecuteLive: execution.mode === "live" && execution.enabled,
    warnings,
    jobStore: {
      durable,
      required: durableRequired,
    },
    rate: {
      source: rate.source,
      executable: rateExecutable,
      fallback: rate.source === "fallback",
    },
    execution,
    zeroG,
    worker: {
      protected: workerProtected,
    },
  };
}

function buildWarnings({
  durable,
  durableRequired,
  rateSource,
  rateExecutable,
  execution,
  zeroG,
  workerProtected,
}: {
  durable: boolean;
  durableRequired: boolean;
  rateSource: string;
  rateExecutable: boolean;
  execution: ReturnType<typeof getExecutionPolicy>;
  zeroG: ReturnType<typeof getZeroGStorageReadiness>;
  workerProtected: boolean;
}): string[] {
  const warnings: string[] = [];

  if (durableRequired && !durable) {
    warnings.push(
      "Durable Redis jobs are required but Upstash Redis is not configured.",
    );
  }

  if (rateSource === "fallback" || !rateExecutable) {
    warnings.push("FX rate is display-only fallback; execution will not run.");
  }

  if (execution.mode === "disabled" && execution.reason) {
    warnings.push(`Live KeeperHub execution disabled: ${execution.reason}`);
  }

  if (!zeroG.configured) {
    warnings.push("0G Storage is not fully configured; writes may use fallback.");
  }

  if (!workerProtected) {
    warnings.push("Worker endpoint has no AGENTREMIT_WORKER_SECRET/CRON_SECRET.");
  }

  return warnings;
}
