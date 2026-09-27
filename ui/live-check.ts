/**
 * Live check: test ANY real calculator, with a human as the browser.
 *
 * The page lists the inputs CivicProbe's delta-directed plan considers most
 * revealing. The reviewer types each into a real calculator in another tab
 * and enters what it displays. The same comparator and diagnosis code used
 * for recorded runs then judges the answers, entirely in this page. There is
 * no server and no automated traffic to anyone's site.
 */
import { Rational } from "../packages/shared/src/rational.js";
import { evaluateExact } from "../packages/policy-engine/src/evaluate.js";
import { compareNumeric } from "../packages/comparator/src/compare.js";
import { diagnoseSchedule } from "../packages/pipeline/src/diagnose.js";
import { reportingLanguage } from "../packages/evidence/src/run.js";
import type { ScheduleDelta } from "../packages/delta-engine/src/schedule-delta.js";
import type { Execution, Run } from "../packages/evidence/src/run.js";
import type { ComparisonConfig } from "../packages/shared/src/result.js";
import { PK_SALARY_TAX_NEW as NEW, PK_SALARY_TAX_OLD as OLD } from "../fixtures/policies/pk-salary-tax.js";
import { TAX_FAULTS, vendorAnnualTax, type TaxFault } from "../fixtures/services/vendor-calculator.js";

type Probe = { requested: number; why: string; tier: string };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => n.toLocaleString("en-US");
const money = (r: Rational | number | string) => "Rs. " + Number(typeof r === "object" ? r.toDecimalString() : r).toLocaleString("en-US", { maximumFractionDigits: 2 });

const state = {
  inputMonthly: false, // calculator asks for MONTHLY salary
  outputMonthly: false, // calculator shows MONTHLY tax
  obs: new Map<number, string>(), // keyed by probe index
  label: "",
};

let probes: Probe[] = [];
let delta: ScheduleDelta;

export function initLiveCheck(taxRun: Run) {
  delta = taxRun.delta as ScheduleDelta;
  const byStrat = (s: string) => taxRun.plan.probes.filter((p) => p.strategy === s);
  const witnesses = byStrat("divergence-witness").map((p) => ({ requested: p.input.income, why: p.rationale.summary, tier: "Most revealing" }));
  const firstAbove = byStrat("boundary").filter((p) => p.rationale.offset === 1).map((p) => ({ requested: p.input.income, why: p.rationale.summary, tier: "Threshold" }));
  const observability = byStrat("boundary").filter((p) => (p.rationale.offset ?? 0) > 1).map((p) => ({ requested: p.input.income, why: p.rationale.summary, tier: "Hidden-threshold check" }));
  const controls = byStrat("control").slice(0, 2).map((p) => ({ requested: p.input.income, why: p.rationale.summary, tier: "Control" }));
  probes = [...witnesses, ...firstAbove, ...observability, ...controls];
}

const effective = (x: number) => (state.inputMonthly ? Math.ceil(x / 12) * 12 : x);
const cfg = (): ComparisonConfig => ({ rounding: "half-up", absoluteTolerance: state.outputMonthly ? 12 : 1 });

function annualObserved(raw: string): string | null {
  const cleaned = raw.replace(/[,\s]|rs\.?/gi, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return state.outputMonthly ? Rational.parse(cleaned).mul(Rational.of(12)).toDecimalString() : Rational.parse(cleaned).toDecimalString();
}

export function liveSection(): string {
  return `<section class="block" id="check" aria-labelledby="live-h">
    <div class="block-head"><h2 id="live-h">Test a calculator thoroughly</h2>
    <p class="plain">In plain words: type 19 carefully chosen salaries into any calculator, enter its answers, and CivicProbe tells you whether it follows the new law and, if not, what it got wrong.</p>
    <p>Pick any Pakistani salary-tax calculator on the web, set it to tax year 2026-27, and enter the incomes below. Type in what it shows. CivicProbe's real comparator and diagnosis judge the answers right here. You are the browser: nothing is sent anywhere, and no site receives automated traffic.</p></div>
    <div class="card">
      <div class="filters" role="group" aria-label="Calculator format" style="margin-bottom:6px">
        <span class="note">The calculator asks for</span>
        <button type="button" class="chip" data-live-in="annual" aria-pressed="${!state.inputMonthly}">annual salary</button>
        <button type="button" class="chip" data-live-in="monthly" aria-pressed="${state.inputMonthly}">monthly salary</button>
        <span class="note" style="margin-left:12px">and shows</span>
        <button type="button" class="chip" data-live-out="annual" aria-pressed="${!state.outputMonthly}">annual tax</button>
        <button type="button" class="chip" data-live-out="monthly" aria-pressed="${state.outputMonthly}">monthly tax</button>
      </div>
      <div class="filters" style="margin-bottom:14px">
        <label class="note" for="live-demo">No calculator handy? Fill with a demo fixture's answers:</label>
        <select id="live-demo" class="ui" style="font:14px var(--sans);background:var(--panel2);color:var(--paper);border:1px solid var(--line);border-radius:6px;padding:7px 10px">
          <option value="">Choose…</option>
          ${(Object.keys(TAX_FAULTS) as TaxFault[]).map((f) => `<option value="${f}">${esc(TAX_FAULTS[f].title)}</option>`).join("")}
        </select>
        <button type="button" class="btn ghost" id="live-clear" style="min-height:34px;padding:6px 12px">Clear</button>
      </div>
      <div class="scroll"><table id="live-table"><thead><tr><th>#</th><th>Why</th><th class="num">Enter this ${state.inputMonthly ? "monthly salary" : "annual salary"}</th><th class="num">Law says (${state.outputMonthly ? "monthly" : "annual"})</th><th class="num">Calculator shows</th><th>Result</th></tr></thead><tbody>
        ${probes.map((p, i) => {
          const x = effective(p.requested);
          const shown = state.inputMonthly ? x / 12 : x;
          const exp = evaluateExact(NEW, x);
          const expShown = state.outputMonthly ? exp.div(Rational.of(12)) : exp;
          return `<tr><td class="num">${i + 1}</td><td class="why-line" title="${esc(p.why)}">${esc(p.tier)}</td>
            <td class="num"><button type="button" class="rowbtn num" data-copy="${shown}" title="Copy">${fmt(shown)}</button></td>
            <td class="num">${money(expShown)}</td>
            <td class="num"><label class="sr" for="live-${i}">Calculator result for ${fmt(shown)}</label><input id="live-${i}" data-live-i="${i}" inputmode="decimal" autocomplete="off" value="${esc(state.obs.get(i) ?? "")}" style="width:9.5em;text-align:right;font:14px var(--num);background:var(--panel2);color:var(--paper);border:1px solid var(--line);border-radius:5px;padding:6px 8px"></td>
            <td id="live-res-${i}"></td></tr>`;
        }).join("")}
      </tbody></table></div>
      <div id="live-summary" class="replay-out" aria-live="polite"></div>
      <p class="note" style="margin-top:12px">${state.inputMonthly ? "Monthly-salary calculators can only represent annual incomes that are multiples of 12, so each probe is rounded up to the nearest one. " : ""}${state.outputMonthly ? "Monthly tax is multiplied by 12 before comparing; because the calculator rounds the monthly figure, the tolerance widens to Rs. 12 a year. " : ""}Tolerance: Rs. ${cfg().absoluteTolerance} after rounding both sides to whole rupees. A mismatch here is a <em>candidate discrepancy</em> against CivicProbe's encoding of the Finance Act 2026 table, not a legal conclusion. Please treat real findings as private and tell the calculator's owner first.</p>
    </div>
  </section>`;
}

function evaluateAll() {
  const c = cfg();
  const execs: Execution[] = [];
  const counts = { CONFORMANT: 0, DISCREPANCY: 0 };
  let invalid = 0;
  const attrib = new Map<string, number>();
  probes.forEach((p, i) => {
    const cell = document.getElementById(`live-res-${i}`);
    if (!cell) return;
    const raw = (state.obs.get(i) ?? "").trim();
    if (!raw) { cell.innerHTML = ""; return; }
    const obs = annualObserved(raw);
    if (obs === null) { cell.innerHTML = `<span class="res UNDETERMINED">Not a number</span>`; invalid++; return; }
    const x = effective(p.requested);
    const cmp = compareNumeric(evaluateExact(NEW, x), obs, c, evaluateExact(OLD, x));
    counts[cmp.result]++;
    if (cmp.result === "DISCREPANCY") attrib.set(cmp.attribution, (attrib.get(cmp.attribution) ?? 0) + 1);
    const hint = cmp.result === "DISCREPANCY" ? (cmp.attribution === "MATCHES_OLD" ? " · matches old law" : ` · off by Rs. ${Number(cmp.absoluteError).toLocaleString("en-US")}`) : "";
    cell.innerHTML = `<span class="res ${cmp.result}">${cmp.result === "CONFORMANT" ? "Conforms" : "Discrepancy"}</span><span class="note">${esc(hint)}</span>`;
    execs.push({ executedInput: { income: x }, observation: { status: "ok", value: obs } } as unknown as Execution);
  });
  const out = document.getElementById("live-summary")!;
  const n = counts.CONFORMANT + counts.DISCREPANCY;
  if (n === 0) {
    out.innerHTML = invalid ? `<p class="note">Enter numbers only, for example 316,000.</p>` : `<p class="note">Results appear as you type. Start with the first rows: they are where a stale edit shows most.</p>`;
    return;
  }
  let diag = "";
  if (counts.DISCREPANCY > 0) {
    const d = diagnoseSchedule(OLD, NEW, delta, execs, c, 12_000_000);
    const h = d.consistent;
    diag = h.length === 0
      ? `None of the ${d.hypothesesTested} single-fault hypotheses reproduces all ${d.observations} answers: more than one thing is wrong, or the calculator follows a different rule entirely.`
      : h.length === 1
        ? `Of ${d.hypothesesTested} single-fault hypotheses, exactly one reproduces all ${d.observations} answers: <em>${esc(h[0].description)}</em>.`
        : `${h.length} of ${d.hypothesesTested} hypotheses reproduce all ${d.observations} answers (${h.slice(0, 4).map((x) => `<em>${esc(x.description)}</em>`).join("; ")}${h.length > 4 ? "; …" : ""}). Fill in more rows to tell them apart.`;
  }
  const verdict = counts.DISCREPANCY ? "DISCREPANCY" : "CONFORMANT";
  out.innerHTML = `<p style="margin:14px 0 6px"><span class="vstate ${verdict}">${counts.DISCREPANCY ? `${counts.DISCREPANCY} of ${n} answers disagree` : `All ${n} answers conform`}</span></p>
    <p class="note" style="margin:0">${esc(reportingLanguage(verdict))}${attrib.get("MATCHES_OLD") ? ` ${attrib.get("MATCHES_OLD")} of the disagreeing answers equal the superseded TY2026 law exactly.` : ""}</p>
    ${diag ? `<p style="margin:8px 0 0"><strong>Diagnosis:</strong> ${diag}</p>` : ""}
    ${n < probes.length ? `<p class="note" style="margin:6px 0 0">${probes.length - n} rows still empty. Every extra answer sharpens the diagnosis.</p>` : ""}
    ${state.label ? `<p class="note" style="margin:6px 0 0">Answers filled from demo fixture: ${esc(state.label)}.</p>` : ""}`;
}

export function wireLive(rerender: () => void) {
  const root = document.getElementById("check");
  if (!root) return;
  root.querySelectorAll<HTMLElement>("[data-live-in]").forEach((b) => b.addEventListener("click", () => { state.inputMonthly = b.dataset.liveIn === "monthly"; state.obs.clear(); state.label = ""; rerender(); }));
  root.querySelectorAll<HTMLElement>("[data-live-out]").forEach((b) => b.addEventListener("click", () => { state.outputMonthly = b.dataset.liveOut === "monthly"; state.obs.clear(); state.label = ""; rerender(); }));
  root.querySelectorAll<HTMLInputElement>("[data-live-i]").forEach((inp) => inp.addEventListener("input", () => { state.obs.set(Number(inp.dataset.liveI), inp.value); state.label = ""; evaluateAll(); }));
  root.querySelectorAll<HTMLElement>("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy!); const t = b.textContent; b.textContent = "copied"; setTimeout(() => (b.textContent = t), 900); } catch { /* clipboard unavailable */ }
  }));
  document.getElementById("live-demo")!.addEventListener("change", (e) => {
    const f = (e.target as HTMLSelectElement).value as TaxFault;
    if (!f) return;
    probes.forEach((p, i) => {
      const x = effective(p.requested);
      const annual = vendorAnnualTax(x, "2026-27", f);
      state.obs.set(i, fmt(state.outputMonthly ? Math.round(annual / 12) : annual));
    });
    state.label = TAX_FAULTS[f].title;
    rerender();
    document.getElementById("live-summary")?.scrollIntoView({ block: "nearest" });
  });
  document.getElementById("live-clear")!.addEventListener("click", () => { state.obs.clear(); state.label = ""; rerender(); });
  evaluateAll();
}

/** Re-render only this section, keeping state. */
export function rerenderLive() {
  const sec = document.getElementById("check");
  if (!sec) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = liveSection();
  sec.replaceWith(tmp.firstElementChild!);
  wireLive(rerenderLive);
}
