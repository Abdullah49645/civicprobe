import type { AdapterDescriptor, Discovery, Observation, ServiceAdapter, TargetDescriptor } from "./types.js";

/**
 * Calls a service implementation function directly (no browser). Used by the
 * benchmark (thousands of trials) and by the published UI's in-browser replay,
 * which re-runs the whole pipeline against the fixture's own implementation
 * and checks that it reproduces the recorded browser run's result digest.
 */
export class InProcessAdapter implements ServiceAdapter {
  readonly descriptor: AdapterDescriptor;
  calls = 0;
  constructor(target: TargetDescriptor, private impl: (input: Record<string, number>) => string, lattice: Record<string, { step: number }>, private offersVersion = true) {
    this.descriptor = { id: `in-process:${target.id}`, version: "2.0.0", kind: "in-process", target: { ...target, nature: "IN_PROCESS" }, inputLattice: lattice };
  }
  async discover(): Promise<Discovery> {
    return { ok: true, httpStatus: null, notUpdated: !this.offersVersion, offeredVersions: [], selectorMatches: {}, notes: this.offersVersion ? [] : ["Implementation does not offer the tested version."] };
  }
  async execute(input: Record<string, number>): Promise<Observation> {
    this.calls++;
    const value = this.impl(input);
    return { status: "ok", value, rawText: value, steps: [{ action: "call", target: this.descriptor.target.id, value: JSON.stringify(input) }] };
  }
  async close(): Promise<void> {}
}
