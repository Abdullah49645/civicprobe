/**
 * The seam between CivicProbe's engine and a real (or fixture) service.
 * A service adapter turns a policy-space input into one observation.
 * It never compares anything and never decides a result.
 */

export type TargetNature =
  /** A local fixture service with an intentionally seeded (or no) fault. */
  | "DEMO_FIXTURE"
  /** A real, external, public service. */
  | "LIVE_TARGET"
  /** The fixture's implementation called directly, without a browser (benchmark / in-browser replay). */
  | "IN_PROCESS";

export interface TargetDescriptor {
  id: string;
  label: string;
  nature: TargetNature;
  url: string;
  /** Human description of the seeded fault, or null for a correct/live target. */
  seededFault: string | null;
}

export interface AdapterDescriptor {
  id: string;
  version: string;
  kind: "browser-form" | "in-process";
  target: TargetDescriptor;
  /**
   * Inputs the service can actually receive, per policy field. A calculator
   * that takes MONTHLY salary can only express annual incomes that are
   * multiples of 12; the pipeline projects each planned input onto this
   * lattice and records both the requested and the executed input.
   */
  inputLattice: Record<string, { step: number }>;
}

export interface TraceStep {
  action: "navigate" | "select" | "fill" | "click" | "wait" | "read" | "call";
  target: string;
  value?: string;
}

export type ObservationStatus =
  | "ok"
  | "unparseable"
  | "assumption_mismatch"
  | "not_updated"
  | "timeout"
  | "navigation_error"
  | "element_not_found"
  | "blocked"
  | "rate_capped"
  | "unexpected_error";

export interface Observation {
  status: ObservationStatus;
  /** Numeric outcome as an exact decimal string ("316003"), or a category label. */
  value: string | null;
  rawText: string;
  detail?: string;
  steps: TraceStep[];
  screenshotPngBase64?: string;
  elapsedMs?: number;
}

export interface Discovery {
  ok: boolean;
  httpStatus: number | null;
  /** The service explicitly does not offer the tested policy version. */
  notUpdated: boolean;
  offeredVersions: string[];
  selectorMatches: Record<string, number>;
  notes: string[];
}

export interface ServiceAdapter {
  readonly descriptor: AdapterDescriptor;
  discover(): Promise<Discovery>;
  execute(input: Record<string, number>, opts?: { screenshot?: boolean }): Promise<Observation>;
  close(): Promise<void>;
}
