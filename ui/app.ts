/**
 * CivicProbe evidence viewer. Everything shown is read from the embedded
 * evidence runs (produced by scripts/evidence.ts against real Chromium) or
 * computed live by the SAME engine packages, bundled into this page. There
 * are no hard-coded result numbers in this file.
 */
import { executeRun } from "../packages/pipeline/src/run.js";
import { SCENARIOS, inProcessAdapterFor, specFor } from "../fixtures/scenarios.js";
import { continuityReport } from "../packages/policy-engine/src/evaluate.js";
import { reportingLanguage } from "../packages/evidence/src/run.js";
import type { Run, Execution } from "../packages/evidence/src/run.js";
import type { ScheduleDelta } from "../packages/delta-engine/src/schedule-delta.js";
import type { ConditionDelta } from "../packages/delta-engine/src/condition-delta.js";
import type { ProgressiveSchedule, EligibilityRule } from "../packages/policy-engine/src/types.js";
import type { Scenario } from "../fixtures/scenarios.js";
import { initLiveCheck, liveSection, wireLive, rerenderLive } from "./live-check.js";
import { citizenCard, wireCitizen } from "./citizen.js";

type Bundle = {
  runs: { scenario: Scenario; run: Run }[];
  manifest: { runner: string; scenarios: Record<string, { recordedAt: string }> };
  bench: {
    seeds: number;
    budgets: number[];
    domains: { domainMax: number; summary: { strategy: string; family: string; mutants: number; detectionRate: Record<string, number>; median: number | null; p95: number | null }[] }[];
    mutants: number;
    equivalent: string[];
    shrink: { structured: number; bisection: number; total: number };
  };
  builtFrom: string;
};

const data: Bundle = JSON.parse(document.getElementById("data")!.textContent!);
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => n.toLocaleString("en-US");
const money = (s: string | number | null) => {
  if (s === null || s === undefined) return "—";
  const v = typeof s === "number" ? s : Number(s);
  if (!Number.isFinite(v)) return esc(s);
  return "Rs. " + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(n % 1e5 === 0 ? 1 : 2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(0)}k` : String(n));
const ratNum = (s: string) => {
  const [a, b] = s.split("/");
  return b ? Number(a) / Number(b) : Number(a);
};
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const live = (msg: string) => { $("#live").textContent = msg; };
const RES_COLOR: Record<string, string> = { CONFORMANT: "var(--ok)", DISCREPANCY: "var(--bad)" };
const resColor = (r: string) => RES_COLOR[r] ?? "var(--unk)";
const resLabel = (r: string) => ({ CONFORMANT: "Conformant", DISCREPANCY: "Discrepancy", UNDETERMINED: "Undetermined", ASSUMPTION_MISMATCH: "Assumption mismatch", NOT_UPDATED: "Not updated", EXECUTION_FAILURE: "Execution failure" })[r] ?? r;
const STRAT: Record<string, [string, string]> = {
  "divergence-witness": ["Divergence witnesses", "Inside each changed row, the input where the old and new rules disagree most."],
  boundary: ["Boundaries", "Each changed threshold T: T, T+1 (the first input the statute places above it), T−1, and the distance at which a misplaced threshold must become visible."],
  interior: ["Interior", "The midpoint of each changed row."],
  "equality-check": ["Equality checks", "Points where two different formulas happen to coincide."],
  control: ["Controls", "Rows the amendment did not touch. Behaviour here must not have changed."],
  "delta-random": ["Seeded draws in the changed region", "Uniform draws restricted to the affected region, fixed seed."],
  shrink: ["Shrinking", "Executed after detection to narrow the counterexample."],
};

let current: { scenario: Scenario; run: Run } = data.runs.find((r) => new URLSearchParams(location.search).get("s") === r.scenario.id) ?? data.runs.find((r) => r.scenario.hero) ?? data.runs[0];
const isSchedule = () => current.run.delta.family === "progressive-schedule";
const planExec = () => current.run.executions.filter((e) => e.phase === "plan");
const inputText = (i: Record<string, number>) => (isSchedule() ? money(i.income) : `age ${i.age}, income ${money(i.income)}`);
const valueText = (v: string | null) => (v === null ? "—" : isSchedule() ? money(v) : esc(v));

// ---------------------------------------------------------------------------

function render() {
  const { scenario: s, run } = current;
  const ce = run.counterexample;
  const counts = run.summary.counts;
  const nDisc = counts.DISCREPANCY;
  const planned = run.summary.planned;
  const verdictHead =
    run.summary.verdict === "DISCREPANCY" ? "Candidate discrepancy found"
    : run.summary.verdict === "CONFORMANT" ? "Conforms on every probed input"
    : run.summary.verdict === "NOT_UPDATED" ? "Service does not offer the new version"
    : resLabel(run.summary.verdict);
  const components = (run.delta as ScheduleDelta | ConditionDelta).components;
  const firstDetect = ce ? ce.foundBy : null;
  const worst = isSchedule()
    ? run.executions.filter((e) => e.result === "DISCREPANCY" && e.comparison && e.comparison.kind === "numeric").map((e) => ({ err: Math.abs(Number(e.observation.value) - Number(e.expected)), input: e.executedInput })).sort((a, b) => b.err - a.err)[0] ?? null
    : null;

  $("#app").innerHTML = `
  <div class="wrap" id="top">
    <div class="hero"><div class="hero-grid">
      <div>
        <h1>The law changed.<span>Did the software?</span></h1>
        <p class="lede">When a tax law changes, the calculators people rely on have to change too, and often they don't. <strong>CivicProbe lets anyone check a calculator's answer in seconds</strong>, and lets auditors test calculators systematically. It computes exactly which answers the new law changes, tests those in a real browser, and pinpoints which part of the law was missed.</p>
        <p class="lede-small"><strong style="color:var(--paper);font-weight:500">First case study: Pakistan's Finance Act 2026</strong>, which cut salaried tax rates and withdrew the 9% surcharge for tax year 2026-27. The engine itself works for any jurisdiction's tax tables and eligibility rules.</p>
        <div class="btn-row"><a class="btn" href="#audit">See what an audit found</a><a class="btn ghost" href="#check">Test a calculator thoroughly</a></div>
      </div>
      ${citizenCard()}
    </div></div>

    <section class="block audit" id="audit" aria-labelledby="audit-h">
      <div class="block-head"><h2 id="audit-h">What an automated audit found</h2>
      <p class="plain">In plain words: CivicProbe tested a calculator the way an auditor would, found where it gives the wrong tax, and worked out which change in the law it missed.</p></div>
    <div class="scnbar ui" role="group" aria-labelledby="picker-label"><span class="picker-label" id="picker-label">Recorded runs:</span>
      ${data.runs.map((r) => `<button type="button" class="chip" data-scn="${esc(r.scenario.id)}" aria-pressed="${r.scenario.id === s.id}"><span class="dot" style="background:${resColor(r.run.summary.verdict)}"></span>${esc(r.scenario.family === "tax" ? r.scenario.faultTitle : "Fee waiver: " + r.scenario.faultTitle.toLowerCase())}</button>`).join("")}
    </div>

      <div class="audit-grid">
        <div class="card how"><h3>How CivicProbe audits a calculator</h3>
          <ol class="steps">
            <li>Diff the old and new law into statute-level edits.</li>
            <li>Compute exactly which incomes must now be taxed differently.</li>
            <li>Plan test inputs where a missed edit would show most.</li>
            <li>Run them on the calculator in a real browser and compare.</li>
            <li>Shrink any failure to the smallest case, and diagnose which edit was missed.</li>
          </ol>
          <p class="note" style="margin:14px 0 0">Every step is deterministic, with no AI deciding results, and every result can be replayed in your browser.</p>
        </div>
      <div class="verdict" aria-labelledby="verdict-h">
        <div class="nature"><span><b class="fixture">Demo fixture.</b> ${s.faultDescription ? "Intentionally seeded fault." : s.offerTy2027 === false ? "Unmodified, old tax year only." : "Correct implementation."}</span><span class="num" title="Content-addressed run id">${esc(run.identity.runId)}</span></div>
        <div class="verdict-body">
          <span class="vstate ${run.summary.verdict}">${resLabel(run.summary.verdict)}</span>
          <h2 class="vhead" id="verdict-h">${verdictHead}</h2>
          <p class="vtext">${esc(s.title)}. ${s.faultDescription ? esc(s.faultDescription) : esc(run.summary.verdictText)}</p>
          ${ce ? `
          <div class="ce">
            <div class="big"><div class="k">Minimal counterexample</div><div class="v num">${inputText(ce.input)}</div></div>
            <div class="exp"><div class="k">The law says</div><div class="v num">${valueText(ce.expected)}</div></div>
            <div class="obs"><div class="k">The service said</div><div class="v num">${valueText(ce.observed)}</div></div>
            ${diagLine() ? `<p class="why" style="color:var(--paper)"><strong>Diagnosis:</strong> ${diagLine()}</p>` : ""}
            ${worst ? (Math.abs(Number(ce.observed) - Number(ce.expected)) < 100
              ? `<p class="why">Not a rounding quibble: the same fault reaches <strong class="num" style="color:var(--bad)">${money(worst.err)}</strong> at ${inputText(worst.input)}. The minimal case is just where it first becomes visible.</p>`
              : `<p class="why">Largest error observed: <strong class="num" style="color:var(--bad)">${money(worst.err)}</strong> at ${inputText(worst.input)}.</p>`) : ""}
            <p class="why">First detected by probe ${firstDetect!.seq + 1} of ${planned} (${esc(STRAT[firstDetect!.strategy]?.[0].toLowerCase() ?? firstDetect!.strategy)}), then shrunk in ${ce.shrinkExecutions} more executions to the smallest failing input.</p>
          </div>
          <div class="btn-row"><button class="btn" type="button" data-open="${ce.seq}">Show the evidence</button><a class="btn ghost" href="#counterexample">How it was shrunk</a></div>`
          : `<div class="btn-row"><a class="btn" href="#ledger">See all ${run.executions.length} executions</a><a class="btn ghost" href="#replay">Replay in your browser</a></div>`}
        </div>
      </div>
      </div>
    </section>

    <div class="instrument" aria-labelledby="inst-h">
      <div class="inst-head"><h2 id="inst-h">${isSchedule() ? "Where the two versions disagree, and where CivicProbe probed" : "Which citizens the amendment affects, and where CivicProbe probed"}</h2>
        <div class="legend ui"><span><i style="background:var(--amend)"></i>${isSchedule() ? "new tax − old tax" : "outcome changed"}</span><span><i style="background:var(--ok)"></i>conformant</span><span><i style="background:var(--bad)"></i>discrepancy</span>${counts.NOT_UPDATED || counts.UNDETERMINED || counts.EXECUTION_FAILURE ? `<span><i style="background:var(--unk)"></i>not compared</span>` : ""}</div>
      </div>
      <div class="chart" id="chart"></div>
      <p class="cap" id="chart-cap"></p>
    </div>

    <div class="strip" role="list">
      <a role="listitem" class="stage amend" href="#change"><span class="n">${components.length}</span><span class="t">edits to the rule, from the two versions</span></a>
      <a role="listitem" class="stage amend" href="#change"><span class="n">${esc(regionShort())}</span><span class="t">${isSchedule() ? "where tax must change (exact)" : "cells where the outcome changed"}</span></a>
      <a role="listitem" class="stage" href="#plan"><span class="n">${planned}</span><span class="t">probes planned from the delta</span></a>
      <a role="listitem" class="stage" href="#ledger"><span class="n">${run.executions.length}</span><span class="t">executions ${run.identity.target.nature === "DEMO_FIXTURE" ? "in Chromium" : ""}${run.summary.shrinkExecutions ? `, ${run.summary.shrinkExecutions} of them shrinking` : ""}</span></a>
      <a role="listitem" class="stage ${nDisc ? "bad" : "ok"}" href="#ledger"><span class="n">${nDisc}/${planned}</span><span class="t">planned probes disagree with the law${counts.NOT_UPDATED ? ` · ${counts.NOT_UPDATED} not updated` : ""}</span></a>
      <a role="listitem" class="stage ${ce ? "bad" : ""}" href="#counterexample"><span class="n">${ce ? esc(isSchedule() ? fmt(ce.input.income) : `age ${ce.input.age}, ${short(ce.input.income)}`) : "none"}</span><span class="t">minimal counterexample</span></a>
    </div>

    ${changeSection()}
    ${planSection()}
    ${ledgerSection()}
    ${counterexampleSection()}
    ${replaySection()}
    ${liveSection()}
    ${benchmarkSection()}
    ${scopeSection()}
  </div>
  <footer><div class="wrap">
    <p>CivicProbe · built for LexHack 2026. Evidence recorded with ${esc(data.manifest.runner)}. This page is ${esc(data.builtFrom)}.</p>
    <p>CivicProbe reports candidate discrepancies against a narrowly encoded, source-linked rule. It does not give legal advice and never asserts that anyone broke the law.</p>
  </div></footer>`;

  drawChart();
  wire();
  wireLive(rerenderLive);
  wireCitizen();
}

function diagLine(): string {
  const d = current.run.diagnosis;
  if (!d) return "";
  const n = d.consistent.length;
  if (n === 0) return `none of ${d.hypothesesTested} single-fault hypotheses reproduces all ${d.observations} observations, so this is not one stale edit.`;
  if (n === 1) { const h = d.consistent[0]; return `of ${d.hypothesesTested} single-fault hypotheses, exactly one reproduces all ${d.observations} observations: <em>${esc(h.description)}</em>${h.components.length && h.components.length < 5 ? ` (${esc(h.components.join(", "))})` : ""}.`; }
  return `${n} of ${d.hypothesesTested} single-fault hypotheses reproduce all ${d.observations} observations: ${d.consistent.map((h) => `<em>${esc(h.description)}</em>`).join("; ")}. The observations do not distinguish between them.`;
}

function regionShort(): string {
  const d = current.run.delta;
  if (d.family === "progressive-schedule") {
    return d.affected.map((iv) => `${iv.loClosed ? "[" : "("}${short(ratNum(iv.lo))}, ${iv.hi === null ? "∞" : short(ratNum(iv.hi))}${iv.hi === null ? ")" : iv.hiClosed ? "]" : ")"}`).join(" ∪ ") || "∅";
  }
  return `${d.cells.filter((c) => c.affected).length} of ${d.cells.length}`;
}

// ---------------------------------------------------------------------------
// Instrument chart

function drawChart() {
  const host = $("#chart");
  const W = Math.max(560, host.clientWidth || 900);
  if (isSchedule()) drawScheduleChart(host, W);
  else drawGridChart(host, W);
}

function drawScheduleChart(host: HTMLElement, W: number) {
  const run = current.run;
  const d = run.delta as ScheduleDelta;
  const oldP = run.policies.old.record as ProgressiveSchedule;
  const newP = run.policies.new.record as ProgressiveSchedule;
  const X = Number(run.plan.options.ceiling) || 12_000_000;
  const H = 330, L = 64, R = 20, top = 64, plotH = 170, rugY = top + plotH + 30;
  const sx = (x: number) => L + (x / X) * (W - L - R);
  const dAt = (x: number) => {
    const c = d.cells.find((c) => c.kind === "open" && ratNum(c.lo) < x && (c.hi === null || x < ratNum(c.hi)));
    if (!c) { const p = d.cells.find((c) => c.kind === "point" && ratNum(c.lo) === x); return p ? ratNum(p.dAtLo) : 0; }
    return ratNum(c.dAtLo) + ratNum(c.slope) * (x - ratNum(c.lo));
  };
  const pts: [number, number][] = [];
  const xs = [0, ...d.breakpoints.map((b) => b.x).filter((x) => x < X), X].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    pts.push([a, dAt(a + 1e-6)], [b, dAt(b - 1e-6)]);
  }
  const minD = Math.min(0, ...pts.map((p) => p[1]));
  const maxD = Math.max(0, ...pts.map((p) => p[1]));
  const span = maxD - minD || 1;
  const sy = (v: number) => top + ((maxD - v) / span) * plotH;
  const y0 = sy(0);
  const area = `M${sx(0)},${y0} ` + pts.map(([x, y]) => `L${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ") + ` L${sx(X)},${y0} Z`;
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
  const oldT = [...oldP.rows.map((r) => r.upTo).filter((x): x is number => x !== null), ...(oldP.surcharge ? [oldP.surcharge.over] : [])];
  const newT = [...newP.rows.map((r) => r.upTo).filter((x): x is number => x !== null), ...(newP.surcharge ? [newP.surcharge.over] : [])];
  const aff = d.affected.map((iv) => [ratNum(iv.lo), iv.hi === null ? X : Math.min(X, ratNum(iv.hi))]);
  const labelEvery = W < 760 ? 2 : 1;
  const ticks = (ts: number[], y: number, cls: string, label: string) => `
    <text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${label}</text>
    <line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/>
    ${ts.filter((t) => t <= X).map((t, i) => `<g><line x1="${sx(t)}" x2="${sx(t)}" y1="${y - 5}" y2="${y + 5}" stroke="${cls}" stroke-width="2"/>${i % labelEvery === 0 || ts.length < 5 ? `<text x="${sx(t)}" y="${y - 9}" text-anchor="middle" font-size="10.5" fill="${cls}">${short(t)}</text>` : ""}</g>`).join("")}`;
  const execs = run.executions;
  const planE = execs.filter((e) => e.phase === "plan");
  const ce = run.counterexample;
  const yTicks = [minD, minD / 2, 0].filter((v, i, a) => a.indexOf(v) === i);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-title chart-desc">
    <title id="chart-title">Difference between the new and old tax, by income, with probe results</title>
    <desc id="chart-desc">${esc(chartDesc())}</desc>
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(214,166,75,.28)" stroke-width="2"/></pattern></defs>
    ${ticks(oldT, 18, "var(--muted)", oldP.effective.label)}
    ${ticks(newT, 44, "var(--paper)", newP.effective.label)}
    ${aff.map(([a, b]) => `<rect x="${sx(a)}" y="${top}" width="${Math.max(1, sx(b) - sx(a))}" height="${plotH}" fill="url(#hatch)"/>`).join("")}
    ${yTicks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)" stroke-dasharray="${v === 0 ? "" : "2 4"}"/><text x="${L - 8}" y="${sy(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)" class="num">${v === 0 ? "0" : "−" + short(Math.abs(Math.round(v)))}</text>`).join("")}
    <path d="${area}" fill="rgba(214,166,75,.22)"/>
    <path d="${line}" fill="none" stroke="var(--amend)" stroke-width="2"/>
    <text x="${sx(aff.length ? aff[0][0] : 0) + 6}" y="${top + plotH - 8}" font-size="11" fill="var(--amend)">${aff.length ? `affected region starts at ${fmt(aff[0][0])}` : "no affected region"}</text>
    <text x="${L + 4}" y="${top + 14}" font-size="11" fill="var(--muted)">${aff.length && aff[0][0] > 0 ? "unchanged" : ""}</text>
    <line x1="${L}" x2="${W - R}" y1="${rugY}" y2="${rugY}" stroke="var(--line2)"/>
    <text x="${L - 8}" y="${rugY + 4}" text-anchor="end" font-size="11" fill="var(--muted)">probes</text>
    ${execs.filter((e) => e.phase === "shrink").map((e) => `<circle cx="${sx(Math.min(X, e.executedInput.income)).toFixed(1)}" cy="${rugY + 24}" r="2" fill="${resColor(e.result)}" opacity=".7"/>`).join("")}
    <text x="${L - 8}" y="${rugY + 28}" text-anchor="end" font-size="11" fill="var(--muted)">shrink</text>
    ${planE.map((e, i) => `<g class="tick" data-open="${e.seq}" tabindex="-1"><line class="drop" style="--i:${i}" x1="${sx(Math.min(X, e.executedInput.income)).toFixed(1)}" x2="${sx(Math.min(X, e.executedInput.income)).toFixed(1)}" y1="${rugY - 12}" y2="${rugY + 12}" stroke="${resColor(e.result)}" stroke-width="${e.result === "DISCREPANCY" ? 3 : 2}"><title>#${e.seq + 1} ${esc(e.strategy)} · ${fmt(e.executedInput.income)} · ${resLabel(e.result)}</title></line></g>`).join("")}
    ${ce ? `<g><line x1="${sx(ce.input.income)}" x2="${sx(ce.input.income)}" y1="${top}" y2="${rugY + 30}" stroke="var(--bad)" stroke-dasharray="3 3"/><text x="${Math.min(sx(ce.input.income) + 6, W - 190)}" y="${rugY + 46}" font-size="12" fill="var(--bad)">minimal counterexample ${fmt(ce.input.income)}</text></g>` : ""}
    <text x="${sx(0)}" y="${H - 6}" font-size="10.5" fill="var(--muted)">0</text><text x="${sx(X)}" y="${H - 6}" text-anchor="end" font-size="10.5" fill="var(--muted)">${fmt(X)} annual taxable income (Rs.)</text>
  </svg>`;
  host.innerHTML = svg;
  $("#chart-cap").textContent = chartDesc();
  animateDrops();
}

function chartDesc(): string {
  const run = current.run;
  const planE = run.executions.filter((e) => e.phase === "plan");
  if (isSchedule()) {
    const d = run.delta as ScheduleDelta;
    const worst = Math.min(...d.cells.filter((c) => c.kind === "point").map((c) => ratNum(c.dAtLo)));
    return `The shaded band is the exact region where the ${run.policies.new.record.effective.label} rule gives a different tax than ${run.policies.old.record.effective.label} (by up to ${money(Math.abs(worst))} at the thresholds shown). ${planE.length} planned probes sit on the rug; ${planE.filter((e) => e.inAffectedRegion).length} of them inside the changed region by design, the rest boundaries and controls. Click a tick for its evidence.`;
  }
  const d = run.delta as ConditionDelta;
  return `Each box is a cell where both versions give a constant outcome; ${d.cells.filter((c) => c.affected).length} cells changed outcome. Dots are the ${planE.length} planned probes. Click one for its evidence.`;
}

function drawGridChart(host: HTMLElement, W: number) {
  const run = current.run;
  const d = run.delta as ConditionDelta;
  const ages = [40, 80], incomes = [0, 2_000_000];
  const H = 330, L = 72, R = 16, T = 14, B = 42;
  const sx = (a: number) => L + ((a - ages[0]) / (ages[1] - ages[0])) * (W - L - R);
  const sy = (v: number) => T + (1 - (v - incomes[0]) / (incomes[1] - incomes[0])) * (H - T - B);
  const clampA = (a: number) => Math.max(ages[0], Math.min(ages[1], a));
  const clampI = (v: number) => Math.max(incomes[0], Math.min(incomes[1], v));
  const cells = d.cells.map((c) => {
    const a0 = clampA(c.ranges.age.lo), a1 = clampA(c.ranges.age.hi + 1), i0 = clampI(c.ranges.income.lo), i1 = clampI(c.ranges.income.hi + 1);
    if (a1 <= a0 || i1 <= i0) return "";
    return `<rect x="${sx(a0)}" y="${sy(i1)}" width="${sx(a1) - sx(a0)}" height="${Math.max(1, sy(i0) - sy(i1))}" fill="${c.affected ? "rgba(214,166,75,.26)" : c.newOutcome === "Eligible" ? "rgba(91,170,142,.07)" : "transparent"}" stroke="var(--line)" stroke-width=".5"><title>age ${c.ranges.age.lo}–${c.ranges.age.hi}, income ${fmt(c.ranges.income.lo)}–${fmt(c.ranges.income.hi)}: ${esc(c.oldOutcome)} → ${esc(c.newOutcome)}</title></rect>`;
  });
  const planE = run.executions.filter((e) => e.phase === "plan");
  const ce = run.counterexample;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="gchart-t"><title id="gchart-t">${esc(chartDesc())}</title>
    ${cells.join("")}
    ${[40, 50, 60, 65, 70, 80].map((a) => `<text x="${sx(a)}" y="${H - 22}" text-anchor="middle" font-size="11" fill="var(--muted)">${a}</text>`).join("")}
    <text x="${(L + W) / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--muted)">age</text>
    ${[0, 1_200_000, 1_500_000, 2_000_000].map((v) => `<text x="${L - 8}" y="${sy(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(v)}</text>`).join("")}
    <text x="12" y="${T + 10}" font-size="11" fill="var(--muted)">income</text>
    ${planE.filter((e) => e.executedInput.age >= ages[0] && e.executedInput.age <= ages[1]).map((e, i) => `<g class="tick" data-open="${e.seq}"><circle class="drop" style="--i:${i}" cx="${sx(e.executedInput.age + 0.5)}" cy="${sy(clampI(e.executedInput.income))}" r="${e.result === "DISCREPANCY" ? 5 : 3.5}" fill="${resColor(e.result)}"><title>#${e.seq + 1} age ${e.executedInput.age}, income ${fmt(e.executedInput.income)} · ${resLabel(e.result)}</title></circle></g>`).join("")}
    ${ce ? `<circle cx="${sx(ce.input.age + 0.5)}" cy="${sy(clampI(ce.input.income))}" r="10" fill="none" stroke="var(--bad)" stroke-width="2"/><text x="${sx(ce.input.age + 0.5) + 14}" y="${sy(clampI(ce.input.income)) - 6}" font-size="12" fill="var(--bad)">minimal counterexample</text>` : ""}
  </svg>`;
  $("#chart-cap").textContent = chartDesc() + " View is clipped to ages 40–80 and incomes up to 2M; the delta covers the full declared domain.";
  animateDrops();
}

function animateDrops() {
  if (reduced()) return;
  const els = $$(".drop", $("#chart"));
  els.forEach((el, i) => {
    el.animate([{ opacity: 0, transform: "translateY(-14px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 120 + i * 18, fill: "backwards", easing: "ease-out" });
  });
}

// ---------------------------------------------------------------------------
// Sections

function changeSection(): string {
  const run = current.run;
  if (run.delta.family === "progressive-schedule") {
    const oldP = run.policies.old.record as ProgressiveSchedule;
    const newP = run.policies.new.record as ProgressiveSchedule;
    const pct = (r: string) => `${+(Number(r) * 100).toFixed(2)}%`;
    const band = (over: number, upTo: number | null, first: boolean) => (first ? `up to ${fmt(upTo!)}` : upTo === null ? `above ${fmt(over)}` : `${fmt(over + 1)} – ${fmt(upTo)}`);
    const rows = newP.rows.map((nr, i) => {
      const or = oldP.rows.find((r) => r.over <= nr.over && (r.upTo === null || nr.over < r.upTo))!;
      const isNew = !oldP.rows.some((r) => r.over === nr.over);
      const oldBandSame = or.over === nr.over && or.upTo === nr.upTo;
      const oldBaseAt = Math.round(or.base + Number(or.rate) * (nr.over - or.over));
      const rateCh = or.rate !== nr.rate, baseCh = oldBaseAt !== nr.base;
      const changed = !oldBandSame || rateCh || baseCh;
      return `<tr class="${changed ? "row-changed" : ""}"><td>${esc(nr.row)}${isNew ? `<span class="newrow">new row</span>` : ""}</td>
        <td class="num">${oldBandSame ? band(nr.over, nr.upTo, i === 0) : `${isNew ? "" : `<del>${band(or.over, or.upTo, false)}</del><br>`}<ins>${band(nr.over, nr.upTo, i === 0)}</ins>`}</td>
        <td class="num">${baseCh ? `<del>${fmt(oldBaseAt)}</del> <ins>${fmt(nr.base)}</ins>` : fmt(nr.base)}</td>
        <td class="num">${rateCh ? `<del>${pct(or.rate)}</del> <ins>${pct(nr.rate)}</ins>` : pct(nr.rate)}</td></tr>`;
    }).join("");
    const sur = oldP.surcharge && !newP.surcharge ? `<tr class="row-changed"><td>${esc(oldP.surcharge.row)} surcharge</td><td class="num">above ${fmt(oldP.surcharge.over)}</td><td class="num">—</td><td class="num"><del>${pct(oldP.surcharge.rateOnTax)} of tax</del> <ins>withdrawn</ins></td></tr>` : "";
    const cont = [continuityReport(oldP), continuityReport(newP)];
    const d = run.delta as ScheduleDelta;
    return `<section class="block" id="change" aria-labelledby="change-h">
      <div class="block-head"><h2 id="change-h">What changed, in the statute's own terms</h2>
    <p class="plain">In plain words: this is the new tax table next to the old one. Crossed-out numbers are last year's, underlined ones are this year's.</p>
      <p>The redline below is derived from the two encoded versions, not typed by hand. From it, CivicProbe's delta engine computes the exact set of incomes whose tax must differ: ${esc(regionText(d))}. It uses rational arithmetic, with no tolerance deciding what counts as "changed".</p></div>
      <div class="two redline">
        <div class="card"><h3>Salaried tax table, ${esc(oldP.effective.label)} → ${esc(newP.effective.label)}</h3>
          <div class="scroll"><table><thead><tr><th>Row</th><th class="num">Taxable income (Rs.)</th><th class="num">Fixed amount</th><th class="num">Rate on excess</th></tr></thead><tbody>${rows}${sur}</tbody></table></div>
          <p class="note" style="margin:12px 0 0">Encoding self-check: ${cont.every((c) => c.length === 0) ? `every fixed amount in both versions equals the tax at the top of the previous row. Both transcriptions are internally consistent (computed in this page).` : `inconsistency found: ${esc(JSON.stringify(cont))}`}</p>
        </div>
        <div class="card"><h3>${d.components.length} edits, extracted automatically</h3>
          <ul class="comps">${d.components.map((c) => `<li><span class="cid">${esc(c.id)}</span><span>${esc(c.summary)}</span></li>`).join("")}</ul>
        </div>
      </div>
      ${provenanceCards()}
      <details class="tier" style="margin-top:18px"><summary><span class="count">${d.cells.length}</span><span>Cell-by-cell proof of the affected region</span><span class="tdesc">every breakpoint and every open interval between them</span></summary><div class="tbody scroll">
        <table><thead><tr><th>Cell</th><th>Old row</th><th>New row</th><th class="num">new − old at start</th><th class="num">slope</th><th>Changed?</th></tr></thead><tbody>
        ${d.cells.map((c) => `<tr><td class="num">${c.kind === "point" ? `{${fmt(ratNum(c.lo))}}` : `(${fmt(ratNum(c.lo))}, ${c.hi === null ? "∞" : fmt(ratNum(c.hi))})`}</td><td>${esc(c.oldRow)}${c.oldSurcharge ? " + surcharge" : ""}</td><td>${esc(c.newRow)}${c.newSurcharge ? " + surcharge" : ""}</td><td class="num">${fmt(Math.round(ratNum(c.dAtLo)))}</td><td class="num">${c.kind === "point" ? "—" : esc(c.slope)}</td><td>${c.affected ? `<span class="res DISCREPANCY" style="background:var(--amend-soft);color:var(--amend)">yes</span>` : "no"}</td></tr>`).join("")}
        </tbody></table><p class="note">${esc(d.guarantee)}</p></div></details>
    </section>`;
  }
  const d = run.delta as ConditionDelta;
  const oldR = run.policies.old.record as EligibilityRule;
  const newR = run.policies.new.record as EligibilityRule;
  return `<section class="block" id="change" aria-labelledby="change-h">
    <div class="block-head"><h2 id="change-h">What changed (an invented demo rule)</h2>
    <p>This second rule family shows that the pipeline is not specific to tax. It is a two-field eligibility rule, and the delta is computed by splitting the input space into boxes on which both versions are constant. Invented for the demo; not a real policy.</p></div>
    <div class="two">
      <div class="card"><h3>Eligibility condition</h3><div class="scroll"><table><thead><tr><th>Field</th><th>${esc(oldR.effective.label)}</th><th>${esc(newR.effective.label)}</th></tr></thead><tbody>
        ${d.components.map((c) => `<tr class="row-changed"><td>${esc(d.fields.find((f) => f.name === c.field)?.label)}</td><td><del>${esc(c.old)}</del></td><td><ins>${esc(c.new)}</ins></td></tr>`).join("")}
      </tbody></table></div><p class="note" style="margin:12px 0 0">${d.cells.length} cells in total; ${d.cells.filter((c) => c.affected).length} changed outcome. ${esc(d.guarantee)}</p></div>
      <div class="card"><h3>${d.components.length} edits</h3><ul class="comps">${d.components.map((c) => `<li><span class="cid">${esc(c.id)}</span><span>${esc(c.summary)}</span></li>`).join("")}</ul></div>
    </div>${provenanceCards()}</section>`;
}

function regionText(d: ScheduleDelta): string {
  if (!d.affected.length) return "none";
  return d.affected.map((iv) => `${iv.loClosed ? "[" : "("}${fmt(ratNum(iv.lo))}, ${iv.hi === null ? "∞" : fmt(ratNum(iv.hi))}${iv.hi === null ? ")" : iv.hiClosed ? "]" : ")"}`).join(" ∪ ") + (d.equalityPoints.length ? ` except ${d.equalityPoints.join(", ")}` : ", with no coincidental equalities");
}

function provenanceCards(): string {
  const run = current.run;
  const card = (label: string, ref: Run["policies"]["old"]) => {
    const p = ref.record.provenance;
    const a = p.authority;
    return `<div class="card prov"><h3>${esc(label)}: ${esc(ref.record.effective.label)} <span class="status" title="${esc(p.statusReason)}">${esc(p.status)}</span></h3>
      <dl>
        <dt>Encodes</dt><dd>${a.url.startsWith("http") ? `<a href="${esc(a.url)}" rel="noopener noreferrer" target="_blank">${esc(a.title)}</a>` : esc(a.title)}, ${esc(a.publisher)}${a.locator ? `, ${esc(a.locator)}` : ""}</dd>
        <dt>Status</dt><dd>${esc(p.statusReason)}</dd>
        ${a.excerpt ? `<dt>Excerpt</dt><dd><span class="mono">${esc(a.excerpt.path)}</span><br><span class="hash">sha256 ${esc(a.excerpt.sha256.slice(0, 24))}…</span></dd>` : ""}
        <dt>Artifact hash</dt><dd>${a.artifactSha256 ? `<span class="hash">${esc(a.artifactSha256)}</span>` : "not yet hashed"}</dd>
        <dt>Rule hash</dt><dd class="hash">${esc(ref.ruleHash.slice(0, 24))}…</dd>
        ${p.corroboration.length ? `<dt>Checked against</dt><dd>${p.corroboration.map((c) => `<a href="${esc(c.url)}" rel="noopener noreferrer" target="_blank">${esc(c.publisher)}</a>`).join(", ")}</dd>` : ""}
      </dl>
      <details style="margin-top:10px"><summary class="note" style="cursor:pointer">${ref.record.assumptions.length} stated assumptions</summary><ul class="note">${ref.record.assumptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
    </div>`;
  };
  return `<div class="two" style="margin-top:18px">${card("Old version", run.policies.old)}${card("New version", run.policies.new)}</div>`;
}

function planSection(): string {
  const run = current.run;
  const bySeq = new Map(run.executions.filter((e) => e.phase === "plan").map((e) => [e.probeId, e]));
  const order = ["divergence-witness", "boundary", "interior", "equality-check", "control", "delta-random"];
  const groups = order.map((st) => ({ st, probes: run.plan.probes.filter((p) => p.strategy === st) })).filter((g) => g.probes.length);
  return `<section class="block" id="plan" aria-labelledby="plan-h">
    <div class="block-head"><h2 id="plan-h">Why these ${run.plan.probes.length} inputs, and not random citizens</h2>
    <p class="plain">In plain words: instead of trying random salaries, CivicProbe picks the ones where a calculator that missed part of the new law would give itself away.</p>
    <p>The plan is derived from the delta. Every probe records why it was chosen. Plan id <span class="num">${esc(run.plan.id)}</span>, generator ${esc(run.plan.generator.name)} ${esc(run.plan.generator.version)}, seed ${run.plan.seed}. The same policies always produce the same plan, byte for byte.</p></div>
    <div class="tiers">${groups.map((g, gi) => `<details class="tier"${gi < 2 ? " open" : ""}><summary><span class="count">${g.probes.length}</span><span>${esc(STRAT[g.st][0])}</span><span class="tdesc">${esc(STRAT[g.st][1])}</span></summary><div class="tbody scroll"><table><thead><tr><th>#</th><th class="num">Input</th><th>Why this input</th><th>Result</th></tr></thead><tbody>
      ${g.probes.map((p) => { const e = bySeq.get(p.id)!; return `<tr><td class="num">${e.seq + 1}</td><td class="num"><button class="rowbtn num" type="button" data-open="${e.seq}">${inputText(e.executedInput)}</button></td><td class="why-line">${esc(p.rationale.summary)}</td><td><span class="res ${e.result}">${resLabel(e.result)}</span></td></tr>`; }).join("")}
    </tbody></table></div></details>`).join("")}</div>
  </section>`;
}

function ledgerSection(): string {
  const run = current.run;
  const states = Object.entries(run.summary.counts).filter(([, n]) => n > 0).map(([s]) => s);
  const hasShrink = run.executions.some((e) => e.phase === "shrink");
  return `<section class="block" id="ledger" aria-labelledby="ledger-h">
    <div class="block-head"><h2 id="ledger-h">Every execution, in order</h2>
    <p class="plain">In plain words: every salary that was tried, what the law says, and what the calculator answered.</p>
    <p>Each row is one real execution, including shrinking steps. Open any row for the full evidence chain from source to interpretation.</p></div>
    <div class="filters" role="group" aria-label="Filter executions">
      <button type="button" class="chip" data-filter="all" aria-pressed="true">All ${run.executions.length}</button>
      ${states.map((s) => `<button type="button" class="chip" data-filter="${s}" aria-pressed="false">${resLabel(s)}</button>`).join("")}
      ${hasShrink ? `<button type="button" class="chip" data-filter="shrink" aria-pressed="false">Shrinking steps</button>` : ""}
      <label class="sr" for="ledger-q">Search by input</label><input id="ledger-q" type="search" placeholder="Search input, e.g. 3200025" inputmode="numeric">
      <span class="count" id="ledger-count"></span>
    </div>
    <div class="scroll card" style="padding:4px 8px"><table id="ledger-table"><thead><tr><th class="num">#</th><th>Phase</th><th class="num">Input</th><th class="num">Law says</th><th class="num">Service said</th><th>Result</th></tr></thead><tbody>
      ${run.executions.map((e) => `<tr data-res="${e.result}" data-phase="${e.phase}" data-q="${Object.values(e.executedInput).join(" ")}"><td class="num">${e.seq + 1}</td><td>${e.phase === "shrink" ? "shrink" : esc(STRAT[e.strategy]?.[0] ?? e.strategy)}</td><td class="num"><button class="rowbtn num" type="button" data-open="${e.seq}">${inputText(e.executedInput)}</button></td><td class="num">${valueText(e.expected)}</td><td class="num">${valueText(e.observation.value)}</td><td><span class="res ${e.result}">${resLabel(e.result)}</span></td></tr>`).join("")}
    </tbody></table></div>
  </section>`;
}

function counterexampleSection(): string {
  const run = current.run;
  const ce = run.counterexample;
  if (!ce) {
    return `<section class="block" id="counterexample" aria-labelledby="ce-h"><div class="block-head"><h2 id="ce-h">No counterexample</h2><p>${run.summary.verdict === "NOT_UPDATED" ? "The service's tax-year selector does not offer the tested version, so CivicProbe made no comparisons. It did not guess, and it sent no probe traffic after discovery. It reports NOT UPDATED, which is a finding about the service, not the law." : "Every planned probe conformed. That is evidence of conformance on these inputs, chosen where the policy change matters most. It is not a proof for all inputs."}</p></div></section>`;
  }
  const e = run.executions[ce.seq];
  const f = run.findings[0];
  const exp = Number(e.comparison && "roundedExpected" in e.comparison ? e.comparison.roundedExpected : e.expected);
  const obs = Number(e.observation.value);
  const shot = e.observation.screenshotRef ? run.screenshots[e.observation.screenshotRef] : null;
  return `<section class="block" id="counterexample" aria-labelledby="ce-h">
    <div class="block-head"><h2 id="ce-h">The smallest input that shows the problem</h2>
    <p class="plain">In plain words: the simplest salary where the calculator is wrong, so anyone can check it by hand.</p>
    <p>Detection says something is wrong. Shrinking says where. Rounding makes failure non-monotone: a stale rate can be invisible, visible, then invisible again a few rupees apart. So CivicProbe does not trust bisection alone. It climbs the policy's own thresholds, bisects, then exhaustively scans the remaining window. It states exactly what it proved.</p></div>
    <div class="two">
      <div class="card">
        <div class="ce" style="border:0;padding:0">
          <div class="big"><div class="k">Minimal counterexample</div><div class="v num">${inputText(ce.input)}</div></div>
          <div class="exp"><div class="k">The law says (${esc(run.policies.new.record.effective.label)})</div><div class="v num">${valueText(ce.expected)}</div></div>
          <div class="obs"><div class="k">The service said</div><div class="v num">${valueText(ce.observed)}</div></div>
          ${isSchedule() ? `<div><div class="k">Difference after rounding</div><div class="v num">${money(Math.abs(obs - exp))}</div></div><div><div class="k">Old rule (${esc(run.policies.old.record.effective.label)}) would say</div><div class="v num">${money(e.expectedOld)}</div></div>` : `<div class="big"><div class="k">Old rule would say</div><div class="v">${esc(e.expectedOld)}</div></div>`}
        </div>
        <p class="cert"><strong>Certificate (${esc(ce.certificate)}).</strong> ${esc(ce.statement)}</p>
        ${f ? `<p class="note" style="margin-top:12px"><strong style="color:var(--paper)">Where it points:</strong> ${esc(f.summary)} Edits in force here: ${esc(f.components.join(", ") || "none")}.</p>` : ""}
        ${diagLine() ? `<p class="note"><strong style="color:var(--paper)">Diagnosis:</strong> ${diagLine()} ${esc(current.run.diagnosis!.method)}</p>` : ""}
        <div class="btn-row"><button class="btn" type="button" data-open="${ce.seq}">Open the evidence chain</button><button class="btn ghost" type="button" id="replay-case">Replay this case here</button></div>
        <p class="replay-out" id="replay-case-out" aria-live="polite"></p>
      </div>
      <div class="card"><h3>What the shrinker proved: ${ce.trace.length} executions</h3>
        <div class="shrink scroll" id="shrink-chart"></div>
        <details style="margin-top:10px"><summary class="note" style="cursor:pointer">Every step</summary><div class="scroll"><table><thead><tr><th>#</th><th>Phase</th><th class="num">Input</th><th>Outcome</th></tr></thead><tbody>${ce.trace.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.phase)}</td><td class="num">${inputText(t.x)}</td><td><span class="res ${t.fails ? "DISCREPANCY" : "CONFORMANT"}">${t.fails ? "fails" : "conforms"}</span></td></tr>`).join("")}</tbody></table></div></details>
        ${shot ? `<h3 style="margin-top:16px">What the browser saw</h3><img class="shot" alt="Screenshot of the fixture calculator showing its result for ${esc(inputText(ce.input).replace(/<[^>]+>/g, ""))}" src="data:image/png;base64,${shot}" width="900" height="640" loading="lazy">` : ""}
      </div>
    </div>
  </section>`;
}

function drawShrink() {
  const host = document.getElementById("shrink-chart");
  const ce = current.run.counterexample;
  if (!host || !ce) return;
  const key = isSchedule() ? "income" : "age";
  const others = Object.keys(ce.input).filter((k) => k !== key);
  const onLine = ce.trace.filter((t) => others.every((k) => t.x[k] === ce.input[k]));
  const seen = new Map<number, boolean>();
  for (const t of onLine) seen.set(t.x[key], t.fails);
  const target = ce.input[key];
  // Window: the contiguous run of executed integers ending at the counterexample, plus a few beyond.
  let lo = target;
  while (seen.has(lo - 1) && target - lo < 90) lo--;
  lo = Math.max(0, lo - 2);
  const hi = target + 6;
  const n = hi - lo + 1;
  const W = Math.max(300, host.clientWidth || 480);
  const cols = Math.min(n, Math.max(10, Math.floor((W - 4) / 14)));
  const rows = Math.ceil(n / cols);
  const cell = Math.floor((W - 4) / cols);
  const H = rows * cell + 4;
  let rects = "";
  for (let i = 0; i < n; i++) {
    const x = lo + i;
    const f = seen.get(x);
    const fill = f === undefined ? "var(--panel2)" : f ? "var(--bad)" : "var(--ok)";
    rects += `<rect x="${2 + (i % cols) * cell}" y="${2 + Math.floor(i / cols) * cell}" width="${cell - 3}" height="${cell - 3}" rx="2" fill="${fill}" ${x === target ? 'stroke="var(--paper)" stroke-width="2"' : ""}><title>${fmt(x)}: ${f === undefined ? "not executed" : f ? "fails" : "conforms"}</title></rect>`;
  }
  const anchors = ce.trace.filter((t) => t.phase === "anchor" || t.phase === "start").length;
  const bis = ce.trace.filter((t) => t.phase === "bisect").length;
  const scan = ce.trace.filter((t) => t.phase === "scan").length;
  const laterPass = [...seen.entries()].filter(([x, f]) => x > target && !f).map(([x]) => x);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="min-width:0" role="img" aria-label="Inputs ${fmt(lo)} to ${fmt(hi)} near the counterexample: green conformed, red failed, grey not executed">${rects}</svg>
    <p class="note" style="margin:8px 0 0">${isSchedule() ? `Inputs ${fmt(lo)}–${fmt(hi)}, one square each. Green executed and conformed, red failed, grey not executed. The outlined square is the counterexample. Before this window: ${anchors} structural anchors, ${bis} bisection steps${scan ? `, then ${scan} exhaustive scan steps` : ""}.${laterPass.length ? ` Note ${laterPass.map(fmt).join(", ")}: larger than the counterexample, yet ${laterPass.length === 1 ? "it conforms" : "they conform"}. Failure is not monotone here, which is why bisection alone cannot be trusted.` : ""}` : `Ages ${lo}–${hi} at the counterexample's other field values. The shrinker lowered one field at a time until no field could move.`}</p>`;
}

function replaySection(): string {
  const run = current.run;
  return `<section class="block" id="replay" aria-labelledby="replay-h">
    <div class="block-head"><h2 id="replay-h">Don't trust the recording. Re-run it here.</h2>
    <p class="plain">In plain words: press the button and your own browser repeats the entire audit, to prove these results weren't made up.</p>
    <p>This page contains the actual CivicProbe engine: policy evaluator, delta engine, planner, comparator and shrinker. It also contains the fixture's calculator code. Re-running recomputes the delta and plan from the policies, executes every probe against the calculator code (no browser automation this time), and checks two hashes against the recorded Chromium run. It is the same check <span class="num">scripts/evidence.ts</span> enforces at build time.</p></div>
    <div class="card">
      <div class="btn-row" style="margin-top:0"><button class="btn" type="button" id="replay-run">Re-run "${esc(current.scenario.faultTitle)}" in this browser</button></div>
      <progress id="replay-prog" value="0" max="${run.executions.length}" hidden></progress>
      <div class="replay-out" id="replay-out" aria-live="polite"><p class="note">Recorded run: plan <span class="num">${esc(run.plan.id)}</span>, result digest <span class="num">${esc(run.resultDigest.slice(0, 16))}…</span>, ${run.executions.length} executions via ${esc(run.environment.runner)} on ${esc(run.environment.finishedAt.slice(0, 10))}.</p></div>
    </div>
  </section>`;
}

let benchBudget = 50;
let benchDomain = 0;
function benchmarkSection(): string {
  const b = data.bench;
  const dom = b.domains[benchDomain];
  const fams: [string, string][] = [["all", "All in-scope mutants"], ["partial-update", "Partial updates"], ["branch-typo", "Branch typos at changed thresholds"]];
  const card = (fam: string, title: string) => {
    const rows = dom.summary.filter((s) => s.family === fam);
    if (!rows.length) return "";
    return `<div class="card bench-card"><h3>${esc(title)} <span class="note">(${rows[0].mutants})</span></h3>
      ${rows.map((r) => { const v = r.detectionRate[String(benchBudget)] ?? 0; const cp = r.strategy.startsWith("delta"); return `<div class="barrow ${cp ? "cp" : ""}"><span class="lbl">${esc(cp ? "CivicProbe" : r.strategy.replace(/ \(.*\)/, ""))}</span><span class="track" role="img" aria-label="${esc(r.strategy)}: ${(v * 100).toFixed(1)}% detected within ${benchBudget} probes"><span class="fill" style="width:${(v * 100).toFixed(1)}%"></span></span><span class="val">${(v * 100).toFixed(v === 1 || v === 0 ? 0 : 1)}%</span></div>`; }).join("")}
    </div>`;
  };
  const dd = (d: typeof dom) => d.summary.find((s) => s.family === "all" && s.strategy.startsWith("delta"))!;
  const rn = (d: typeof dom) => d.summary.find((s) => s.family === "all" && s.strategy.startsWith("random"))!;
  return `<section class="block" id="benchmark" aria-labelledby="bench-h">
    <div class="block-head"><h2 id="bench-h">Is targeted probing actually better? Measured, with the losses included.</h2>
    <p class="plain">In plain words: we built 60 subtly broken calculators and counted how many each testing method caught. Within 50 tries, CivicProbe caught every catchable one; random testing caught about a third.</p>
    <p>The benchmark uses mutation analysis. ${b.mutants} faulty implementations are generated mechanically from the two versions: every edit left stale on its own, the whole table stale, the withdrawn surcharge still applied, a branch typo at every threshold, and rounding faults. Ground truth is computed exactly. ${b.equivalent.length} mutants are provably undetectable under the comparison rule, so they are excluded. Random is repeated over ${b.seeds} seeds.</p></div>
    <div class="budget-tabs" role="group" aria-label="Probe budget"><span class="note">Share detected within</span>${b.budgets.map((x) => `<button type="button" class="chip" data-budget="${x}" aria-pressed="${x === benchBudget}">${x} probes${x === 50 ? " (CivicProbe's full plan: " + current.run.plan.probes.length + ")" : ""}</button>`).join("")}
      <span class="note" style="margin-left:12px">Domain</span>${b.domains.map((d, i) => `<button type="button" class="chip" data-domain="${i}" aria-pressed="${i === benchDomain}">≤ ${short(d.domainMax)}</button>`).join("")}</div>
    <div class="bench-grid">${fams.map(([f, t]) => card(f, t)).join("")}</div>
    <div class="two" style="margin-top:18px">
      <div class="card"><h3>What the numbers say</h3><ul class="note" style="margin:0;padding-left:1.1em">
        <li>Within 50 probes CivicProbe detects ${(dd(dom).detectionRate["50"] * 100).toFixed(0)}% of in-scope faults. Random detects ${(rn(dom).detectionRate["50"] * 100).toFixed(1)}%.</li>
        <li>On partial updates random does well on average, because those faults are broad. CivicProbe's advantage there is the worst case, not the average.</li>
        <li>Narrow typos are where random and grid essentially never succeed. Plain boundary testing also misses them: at T±1 a misplaced threshold is hidden by rounding.</li>
        <li>Random is faster on display-rounding faults. Typos at thresholds the amendment did not touch are out of scope, and CivicProbe finds none of them. Both results are in <span class="num">docs/benchmark.md</span>.</li>
      </ul></div>
      <div class="card"><h3>Counterexample quality</h3><p class="note" style="margin-top:0">Exact minimal failing input recovered, against computed ground truth:</p>
        <div class="barrow cp"><span class="lbl">CivicProbe shrinker</span><span class="track"><span class="fill" style="width:${(100 * b.shrink.structured / b.shrink.total).toFixed(1)}%"></span></span><span class="val">${b.shrink.structured}/${b.shrink.total}</span></div>
        <div class="barrow"><span class="lbl">Bisection only</span><span class="track"><span class="fill" style="width:${(100 * b.shrink.bisection / b.shrink.total).toFixed(1)}%"></span></span><span class="val">${b.shrink.bisection}/${b.shrink.total}</span></div>
        <p class="note">Detection rate as the domain grows (≤25 / ≤50 probes): ${b.domains.map((d) => `≤${short(d.domainMax)}: CivicProbe ${(dd(d).detectionRate["25"] * 100).toFixed(0)}/${(dd(d).detectionRate["50"] * 100).toFixed(0)}%, random ${(rn(d).detectionRate["25"] * 100).toFixed(0)}/${(rn(d).detectionRate["50"] * 100).toFixed(0)}%`).join("; ")}.</p>
      </div>
    </div>
  </section>`;
}

function scopeSection(): string {
  return `<section class="block" id="scope" aria-labelledby="scope-h">
    <div class="block-head"><h2 id="scope-h">What is real here, what is a fixture, and what is new</h2>
    <p class="plain">In plain words: the law is real; the calculators tested in the recordings are practice copies with deliberate mistakes, and we say so everywhere.</p></div>
    <div class="scope">
      <div class="card"><h3>Real</h3><ul>
        <li><strong>The oracle.</strong> Pakistan's salaried tax table for TY2026 and TY2027, including withdrawal of the 9% surcharge for salaried persons. Encoded from the Finance Bill 2026 and checked against a post-enactment professional review. Both versions reproduce 9 independently published worked values exactly, and 5 more for the old table. Status CORROBORATED, not LOCKED: the enacted Act's file has not been hashed yet.</li>
        <li><strong>The execution.</strong> Every recorded run drove real Chromium through a real HTML form and parsed the visible result text. It uses the same adapter class a live calculator would.</li>
      </ul></div>
      <div class="card"><h3>Fixture, and labelled as such</h3><ul>
        <li><strong>The services under test are local demo fixtures</strong> with intentionally seeded faults. They are independent implementations written like a public calculator site; they do not reuse CivicProbe's oracle code.</li>
        <li><strong>No live government or third-party service has been tested yet.</strong> The build sandbox has no outbound network. Several public calculators' page text still mentions a 9% surcharge for 2026-27. That is a lead to test first (probe just above Rs. 10,000,000), not a finding.</li>
        <li>The fee-waiver rule is invented, to show the second rule family.</li>
      </ul></div>
      <div class="card"><h3>What is new, stated narrowly</h3><ul>
        <li>Not the parts: property-based testing, boundary-value analysis, mutation testing, policy-as-code and browser automation all exist.</li>
        <li><strong>The combination, and its focus:</strong> taking the <em>difference between two versions</em> of a rule as the test oracle's search space. That means an exact affected region, probes placed where an unimplemented edit is most visible, observability-aware boundaries, shrinking with stated certificates, and attribution of each failure to the edit it points at.</li>
      </ul></div>
      <div class="card"><h3>Limits and conduct</h3><ul>
        <li>Exact delta only for the two rule families encoded here. Everything else is out of scope and says so.</li>
        <li>CivicProbe never asserts a legal violation. A discrepancy starts as a private finding.</li>
        <li>Browser access is read-only by construction. Off-site navigation and state-changing requests to other origins are blocked; rate caps and robots.txt checks apply. It never bypasses CAPTCHAs or authentication.</li>
        <li>No LLM decides anything. The comparator is deterministic and every decision is reproducible from the evidence.</li>
      </ul></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Evidence drawer

let lastFocus: HTMLElement | null = null;
function openDrawer(seq: number) {
  const run = current.run;
  const e = run.executions[seq];
  if (!e) return;
  lastFocus = document.activeElement as HTMLElement;
  const newP = run.policies.new.record;
  const a = newP.provenance.authority;
  const shot = e.observation.screenshotRef ? run.screenshots[e.observation.screenshotRef] : null;
  const c = e.comparison;
  const cfg = run.identity.comparison;
  const deltaComp = (run.delta as ScheduleDelta | ConditionDelta).components.filter((x) => e.components.includes(x.id));
  $("#drawer-title").textContent = `Execution ${e.seq + 1}: ${inputText(e.executedInput).replace(/<[^>]+>/g, "")}`;
  $("#drawer-body").innerHTML = `
    <div class="sumgrid">
      <div><div class="k">Result</div><div class="v"><span class="res ${e.result}">${resLabel(e.result)}</span></div></div>
      <div><div class="k">Input${e.requestedInput && JSON.stringify(e.requestedInput) !== JSON.stringify(e.executedInput) ? " (projected)" : ""}</div><div class="v num">${inputText(e.executedInput)}</div></div>
      <div><div class="k">The law says</div><div class="v num">${valueText(e.expected)}</div></div>
      <div><div class="k">The service said</div><div class="v num">${valueText(e.observation.value)}</div></div>
    </div>
    <p class="note" style="margin-top:0">${esc(reportingLanguage(e.result))}${e.attribution === "MATCHES_OLD" ? " The observed value equals what the superseded rule gives." : ""}</p>
    <ol class="chain">
      <li><details><summary><b>Source</b><span>${esc(a.title)} · ${esc(newP.provenance.status)}</span></summary><div class="cbody">${esc(a.publisher)}. ${a.locator ? esc(a.locator) + ". " : ""}Retrieved ${esc(a.retrievedAt)}. ${a.url.startsWith("http") ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open source</a>. ` : ""}${a.excerpt ? `Verbatim excerpt <code>${esc(a.excerpt.path)}</code>, sha256 <code>${esc(a.excerpt.sha256)}</code>.` : ""}<br>${esc(newP.provenance.statusReason)}</div></details></li>
      <li><details><summary><b>Rule</b><span>${esc(newP.id)}</span></summary><div class="cbody">Encoded rule hash <code>${esc(run.policies.new.ruleHash)}</code>. Assumptions: ${newP.assumptions.map(esc).join(" ")}</div></details></li>
      <li class="${deltaComp.length ? "hot" : ""}"><details><summary><b>Delta</b><span>${deltaComp.length ? esc(deltaComp.map((x) => x.id).join(", ")) : e.inAffectedRegion ? "inside the affected region" : "outside the affected region"}</span></summary><div class="cbody">${deltaComp.length ? deltaComp.map((x) => `${esc(x.id)}: ${esc(x.summary)}`).join("<br>") : "No edit applies at this input: behaviour must be the same under both versions."}<br>Delta id <code>${esc(run.delta.id)}</code>.</div></details></li>
      <li class="hot"><details open><summary><b>Why this input</b><span>${esc(e.phase === "shrink" ? "shrinking step" : STRAT[e.strategy]?.[0] ?? e.strategy)}</span></summary><div class="cbody">${esc(e.rationale.summary)}${e.rationale.expectedDelta ? `<br>New − old at this input: <code>${esc(ratNum(e.rationale.expectedDelta).toLocaleString("en-US", { maximumFractionDigits: 2 }))}</code>.` : ""}<br>Probe id <code>${esc(e.probeId)}</code>, plan <code>${esc(run.plan.id)}</code>, seed ${run.plan.seed}.</div></details></li>
      <li><details open><summary><b>Expected</b><span class="num">${valueText(e.expected)}</span></summary><div class="cbody">${esc(e.derivation)}<br>Old rule: ${valueText(e.expectedOld)}.</div></details></li>
      <li><details${e.result !== "CONFORMANT" ? " open" : ""}><summary><b>Observed</b><span>${esc(e.observation.status)}${e.observation.value !== null ? " · " + valueText(e.observation.value) : ""}</span></summary><div class="cbody">Visible text read: “${esc(e.observation.rawText || "—")}”${e.observation.detail ? `<br>${esc(e.observation.detail)}` : ""}<br>Trace: ${e.observation.steps.map((s) => `${esc(s.action)} <code>${esc(s.target)}</code>${s.value ? ` = <code>${esc(s.value)}</code>` : ""}`).join(" → ") || "no request made"}.<br>Adapter ${esc(run.identity.adapter.id)} ${esc(run.identity.adapter.version)}; target ${esc(run.identity.target.label)} (${esc(run.identity.target.nature)}).${shot ? `<br><img class="shot" style="margin-top:8px" alt="Screenshot captured for this execution" src="data:image/png;base64,${shot}" width="900" height="640">` : ""}</div></details></li>
      <li class="hot"><details open><summary><b>Comparison</b><span>${esc(e.reason)}</span></summary><div class="cbody">${c ? `Config: ${esc(JSON.stringify(cfg))}. ${esc(run.identity.comparisonJustification)}` : "No comparison: nothing was observed to compare."}</div></details></li>
      <li><details><summary><b>Interpretation</b><span>${esc(resLabel(e.result))}</span></summary><div class="cbody">${esc(reportingLanguage(e.result))} Run id <code>${esc(run.identity.runId)}</code>; replay with <code>${esc(run.replay.command)}</code>.</div></details></li>
    </ol>
    <div class="btn-row"><button class="btn ghost" type="button" id="copy-json">Copy this execution as JSON</button></div>
    <details style="margin-top:12px"><summary class="note" style="cursor:pointer">Raw record</summary><pre class="raw">${esc(JSON.stringify(e, null, 2))}</pre></details>`;
  $("#drawer").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("on");
  document.body.style.overflow = "hidden";
  $("#drawer-close").focus();
  $("#copy-json").onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(e, null, 2)); live("Execution copied as JSON."); ($("#copy-json")).textContent = "Copied"; }
    catch { live("Copy failed: clipboard not available."); }
  };
}
function closeDrawer() {
  $("#drawer").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("on");
  document.body.style.overflow = "";
  lastFocus?.focus();
}

// ---------------------------------------------------------------------------
// Replay (runs the real engine in the page)

async function replayScenario() {
  const btn = $<HTMLButtonElement>("#replay-run");
  const out = $("#replay-out");
  const prog = $<HTMLProgressElement>("#replay-prog");
  btn.disabled = true;
  prog.hidden = false;
  prog.value = 0;
  const s = SCENARIOS.find((x) => x.id === current.scenario.id)!;
  const t0 = performance.now();
  let n = 0;
  const run = await executeRun({ ...specFor(s, "in-browser replay"), screenshots: false }, inProcessAdapterFor(s), {
    onExecution: () => { n++; if (n % 8 === 0) prog.value = n; },
  });
  prog.value = prog.max;
  const rec = current.run;
  const ok = (a: string, b: string) => (a === b ? `<span class="match">matches</span>` : `<span class="nomatch">DIFFERS</span>`);
  out.innerHTML = `<div class="scroll"><table><tbody>
    <tr><td>Delta recomputed</td><td class="num">${esc(run.delta.id)}</td><td>${ok(run.delta.id, rec.delta.id)}</td></tr>
    <tr><td>Plan recomputed</td><td class="num">${esc(run.plan.id)}</td><td>${ok(run.plan.id, rec.plan.id)}</td></tr>
    <tr><td>Executions</td><td class="num">${run.executions.length}</td><td>${run.executions.length === rec.executions.length ? `<span class="match">same count</span>` : `<span class="nomatch">DIFFERS</span>`}</td></tr>
    <tr><td>Result digest</td><td class="num">${esc(run.resultDigest.slice(0, 16))}…</td><td>${ok(run.resultDigest, rec.resultDigest)}</td></tr>
    <tr><td>Minimal counterexample</td><td class="num">${run.counterexample ? inputText(run.counterexample.input) : "none"}</td><td>${ok(JSON.stringify(run.counterexample?.input ?? null), JSON.stringify(rec.counterexample?.input ?? null))}</td></tr>
  </tbody></table></div><p class="note">Recomputed in ${Math.round(performance.now() - t0)} ms. A matching digest means every probe, input, observed value and result is identical to the recorded Chromium run.</p>`;
  live(run.resultDigest === rec.resultDigest ? "Replay complete: result digest matches the recorded run." : "Replay complete: result digest differs from the recorded run.");
  btn.disabled = false;
}

async function replayCase() {
  const ce = current.run.counterexample!;
  const s = SCENARIOS.find((x) => x.id === current.scenario.id)!;
  const obs = await inProcessAdapterFor(s).execute(ce.input);
  $("#replay-case-out").innerHTML = `Executed ${inputText(ce.input)} against the fixture's calculator code in this page: it returns <span class="num">${valueText(obs.value)}</span>. The law says <span class="num">${valueText(ce.expected)}</span>. ${obs.value === ce.observed ? `<span class="match">Same as recorded.</span>` : `<span class="nomatch">Differs from the recorded ${valueText(ce.observed)}.</span>`}`;
}

// ---------------------------------------------------------------------------
// Wiring

function wire() {
  $$("[data-scn]").forEach((b) => b.addEventListener("click", () => {
    current = data.runs.find((r) => r.scenario.id === b.dataset.scn)!;
    history.replaceState(null, "", `?s=${encodeURIComponent(current.scenario.id)}${location.hash}`);
    render();
    $<HTMLElement>(`[data-scn="${CSS.escape(current.scenario.id)}"]`).focus();
    live(`Showing ${current.scenario.faultTitle}: ${resLabel(current.run.summary.verdict)}.`);
  }));
  $$("[data-open]").forEach((el) => el.addEventListener("click", () => openDrawer(Number(el.dataset.open))));
  $$("[data-budget]").forEach((b) => b.addEventListener("click", () => { benchBudget = Number(b.dataset.budget); rerenderBench(); }));
  $$("[data-domain]").forEach((b) => b.addEventListener("click", () => { benchDomain = Number(b.dataset.domain); rerenderBench(); }));
  $("#replay-run")?.addEventListener("click", () => { replayScenario().catch((err) => { $("#replay-out").textContent = `Replay failed: ${err}`; ($("#replay-run") as HTMLButtonElement).disabled = false; }); });
  $("#replay-case")?.addEventListener("click", () => void replayCase());
  // ledger filter
  let filter = "all";
  const apply = () => {
    const q = ($<HTMLInputElement>("#ledger-q").value || "").replace(/[^0-9 ]/g, "").trim();
    let shown = 0;
    $$("#ledger-table tbody tr").forEach((tr) => {
      const okF = filter === "all" || (filter === "shrink" ? tr.dataset.phase === "shrink" : tr.dataset.res === filter);
      const okQ = !q || (tr.dataset.q ?? "").includes(q);
      tr.hidden = !(okF && okQ);
      if (!tr.hidden) shown++;
    });
    $("#ledger-count").textContent = `${shown} shown`;
  };
  $$("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter!;
    $$("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    apply();
    live(`${$("#ledger-count").textContent}.`);
  }));
  $("#ledger-q").addEventListener("input", apply);
  apply();
  drawShrink();
  // nav highlight
  const links = $$(".bar nav a");
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${en.target.id}`)));
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$("section.block").forEach((s) => io.observe(s));
}

function rerenderBench() {
  const sec = $("#benchmark");
  const tmp = document.createElement("div");
  tmp.innerHTML = benchmarkSection();
  sec.replaceWith(tmp.firstElementChild!);
  $$("[data-budget]").forEach((b) => b.addEventListener("click", () => { benchBudget = Number(b.dataset.budget); rerenderBench(); }));
  $$("[data-domain]").forEach((b) => b.addEventListener("click", () => { benchDomain = Number(b.dataset.domain); rerenderBench(); }));
  $<HTMLElement>(`[data-budget="${benchBudget}"]`)?.focus();
}

$("#drawer-close").addEventListener("click", closeDrawer);
$("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (ev) => {
  const open = $("#drawer").classList.contains("on");
  if (!open) return;
  if (ev.key === "Escape") { ev.preventDefault(); closeDrawer(); }
  if (ev.key === "Tab") {
    const f = $$('#drawer button, #drawer summary, #drawer a[href], #drawer [tabindex]:not([tabindex="-1"])').filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
});
let rt = 0;
window.addEventListener("resize", () => { clearTimeout(rt); rt = window.setTimeout(() => { drawChart(); drawShrink(); }, 150); });

initLiveCheck(data.runs.find((r) => r.scenario.id === "tax-stale-rate")!.run);
render();
