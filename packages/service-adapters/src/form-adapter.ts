import type { Page } from "playwright";
import { BrowserRunner } from "../../browser-runner/src/runner.js";
import type { RunnerConfig } from "../../browser-runner/src/config.js";
import type { AdapterDescriptor, Discovery, Observation, ServiceAdapter, TargetDescriptor, TraceStep } from "./types.js";

/**
 * One adapter class for every form-shaped service — the local fixtures AND
 * live public calculators. Only the configuration differs. That is the
 * point: the demo fixture exercises exactly the code a live run uses.
 *
 * It reads the VISIBLE result text and parses it with an explicit pattern.
 * (The previous fixture adapter read a hidden machine-readable attribute that
 * no real calculator has.)
 */
export interface FormAdapterConfig {
  id: string;
  version: string;
  target: TargetDescriptor;
  allowedOrigins: string[];
  runner: RunnerConfig;
  fields: {
    name: string;
    selector: string;
    /** How a policy-space value becomes what is typed. */
    transform?: "identity" | "annual-to-monthly";
  }[];
  /** Optional policy-version selector (e.g. a tax-year dropdown). */
  versionSelect?: { selector: string; optionPattern: string };
  submit: string;
  result: string;
  parse:
    | {
        kind: "number";
        /** Regex with exactly one capture group for the number, applied to the visible result text. */
        pattern: string;
        /** Regex that MUST match the result text, else ASSUMPTION_MISMATCH (e.g. "annual"). */
        unitGuard?: string;
      }
    | { kind: "category"; categories: string[] };
}

export class FormAdapter implements ServiceAdapter {
  readonly descriptor: AdapterDescriptor;
  private runner: BrowserRunner;
  private versionLabel: string | null = null;

  constructor(private cfg: FormAdapterConfig) {
    this.runner = new BrowserRunner(cfg.runner, cfg.allowedOrigins);
    const lattice: Record<string, { step: number }> = {};
    for (const f of cfg.fields) lattice[f.name] = { step: f.transform === "annual-to-monthly" ? 12 : 1 };
    this.descriptor = { id: cfg.id, version: cfg.version, kind: "browser-form", target: cfg.target, inputLattice: lattice };
  }

  get blockedRequests(): string[] {
    return this.runner.blocked;
  }
  get pageLoads(): number {
    return this.runner.pageLoads;
  }

  async discover(): Promise<Discovery> {
    const notes: string[] = [];
    await this.runner.throttle();
    const page = await this.runner.page();
    const resp = await page.goto(this.cfg.target.url);
    const httpStatus = resp ? resp.status() : null;
    const selectorMatches: Record<string, number> = {};
    const count = async (sel: string) => {
      try {
        return await page.locator(sel).count();
      } catch {
        return -1;
      }
    };
    for (const f of this.cfg.fields) selectorMatches[f.selector] = await count(f.selector);
    selectorMatches[this.cfg.submit] = await count(this.cfg.submit);
    let offered: string[] = [];
    let notUpdated = false;
    if (this.cfg.versionSelect) {
      const vs = this.cfg.versionSelect;
      selectorMatches[vs.selector] = await count(vs.selector);
      if (selectorMatches[vs.selector] > 0) {
        offered = (await page.locator(`${vs.selector} option`).allTextContents()).map((s) => s.trim());
        const re = new RegExp(vs.optionPattern, "i");
        this.versionLabel = offered.find((o) => re.test(o)) ?? null;
        if (!this.versionLabel) {
          notUpdated = true;
          notes.push(`The version selector offers [${offered.join(", ")}] and nothing matching /${vs.optionPattern}/: the service does not offer the tested policy version.`);
        }
      }
    }
    const ok = httpStatus !== null && httpStatus >= 200 && httpStatus < 400 && Object.values(selectorMatches).every((n) => n > 0);
    if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 400)) notes.push(`HTTP ${httpStatus}: probably an error or blocked page, not the calculator.`);
    for (const [sel, n] of Object.entries(selectorMatches)) if (n <= 0) notes.push(`Selector ${sel} matched ${n === -1 ? "nothing (invalid selector)" : "no elements"}.`);
    return { ok, httpStatus, notUpdated, offeredVersions: offered, selectorMatches, notes };
  }

  async execute(input: Record<string, number>, opts: { screenshot?: boolean } = {}): Promise<Observation> {
    const steps: TraceStep[] = [];
    const t0 = Date.now();
    let page: Page | null = null;
    try {
      await this.runner.throttle();
    } catch (e) {
      return { status: "rate_capped", value: null, rawText: "", detail: (e as Error).message, steps };
    }
    try {
      page = await this.runner.page();
      steps.push({ action: "navigate", target: this.cfg.target.url });
      const resp = await page.goto(this.cfg.target.url);
      if (resp && (resp.status() < 200 || resp.status() >= 400)) {
        return { status: "navigation_error", value: null, rawText: "", detail: `HTTP ${resp.status()}`, steps };
      }
      if (this.cfg.versionSelect && this.versionLabel) {
        steps.push({ action: "select", target: this.cfg.versionSelect.selector, value: this.versionLabel });
        await page.selectOption(this.cfg.versionSelect.selector, { label: this.versionLabel });
      }
      for (const f of this.cfg.fields) {
        const v = input[f.name];
        if (v === undefined) throw new Error(`no value for field ${f.name}`);
        const typed = f.transform === "annual-to-monthly" ? v / 12 : v;
        if (!Number.isInteger(typed)) {
          return { status: "assumption_mismatch", value: null, rawText: "", detail: `${f.name}=${v} is not expressible in this form (${f.transform}); the pipeline should have projected it.`, steps };
        }
        steps.push({ action: "fill", target: f.selector, value: String(typed) });
        await page.fill(f.selector, String(typed));
      }
      steps.push({ action: "click", target: this.cfg.submit });
      await Promise.all([page.waitForLoadState("domcontentloaded"), page.click(this.cfg.submit)]);
      steps.push({ action: "wait", target: this.cfg.result });
      await page.waitForSelector(this.cfg.result, { state: "visible" });
      const raw = ((await page.locator(this.cfg.result).first().innerText()) ?? "").replace(/\s+/g, " ").trim();
      steps.push({ action: "read", target: this.cfg.result, value: raw });
      const shot = opts.screenshot ? (await page.screenshot({ type: "png" })).toString("base64") : undefined;
      const parsed = this.parse(raw);
      return { ...parsed, rawText: raw, steps, screenshotPngBase64: shot, elapsedMs: Date.now() - t0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = /blockedbyclient/i.test(msg) ? "blocked" : /timeout/i.test(msg) ? "timeout" : /net::|navigation/i.test(msg) ? "navigation_error" : /selector|locator|waiting for/i.test(msg) ? "element_not_found" : "unexpected_error";
      return { status, value: null, rawText: "", detail: msg.split("\n")[0], steps, elapsedMs: Date.now() - t0 };
    }
  }

  private parse(raw: string): Pick<Observation, "status" | "value" | "detail"> {
    const p = this.cfg.parse;
    if (p.kind === "category") {
      const hits = p.categories.filter((c) => new RegExp(`(^|\\W)${escapeRe(c)}(\\W|$)`, "i").test(raw));
      // Prefer the longest label when one contains another ("Not eligible" ⊃ "eligible").
      hits.sort((a, b) => b.length - a.length);
      const winners = hits.filter((h) => !hits.some((o) => o !== h && o.toLowerCase().includes(h.toLowerCase())));
      if (winners.length !== 1) return { status: "unparseable", value: null, detail: `Expected exactly one of [${p.categories.join(", ")}], found ${winners.length}.` };
      return { status: "ok", value: winners[0] };
    }
    if (p.unitGuard && !new RegExp(p.unitGuard, "i").test(raw)) {
      return { status: "assumption_mismatch", value: null, detail: `Result text does not match /${p.unitGuard}/; the service may report a different quantity than the oracle (e.g. monthly instead of annual).` };
    }
    const matches = [...raw.matchAll(new RegExp(p.pattern, "gi"))];
    if (matches.length !== 1) return { status: "unparseable", value: null, detail: `Pattern /${p.pattern}/ matched ${matches.length} times; need exactly one.` };
    const num = matches[0][1].replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(num)) return { status: "unparseable", value: null, detail: `Captured "${matches[0][1]}" is not a plain number.` };
    return { status: "ok", value: stripZeros(num) };
  }

  async close(): Promise<void> {
    await this.runner.close();
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function stripZeros(num: string): string {
  if (!num.includes(".")) return num.replace(/^(-?)0+(?=\d)/, "$1");
  const s = num.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(/^(-?)0+(?=\d)/, "$1");
}
