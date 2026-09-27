export interface RunnerConfig {
  /** Minimum delay between consecutive page loads against the target, ms. */
  minDelayMs: number;
  /** Hard cap on page loads per runner lifetime. Exceeding it is an EXECUTION_FAILURE, never a silent skip. */
  maxRequestsPerRun: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
}

/** Live public services: slow, capped, and willing to give up rather than hammer a site. */
export const LIVE_RUNNER_CONFIG: RunnerConfig = {
  minDelayMs: 1_500,
  maxRequestsPerRun: 120,
  navigationTimeoutMs: 20_000,
  actionTimeoutMs: 10_000,
};

/** Our own localhost fixture: fast, but the same code path and the same guard. */
export const FIXTURE_RUNNER_CONFIG: RunnerConfig = {
  minDelayMs: 0,
  maxRequestsPerRun: 5_000,
  navigationTimeoutMs: 5_000,
  actionTimeoutMs: 3_000,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
