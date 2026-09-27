/**
 * For taxpayers: a plain-language check any salaried person can use in
 * seconds. It uses the same oracle (exact evaluator), comparator and
 * old/new attribution as the audit engine. English and Urdu.
 * Nothing typed leaves the page.
 */
import { Rational } from "../packages/shared/src/rational.js";
import { evaluateExact, rowFor } from "../packages/policy-engine/src/evaluate.js";
import { compareNumeric, roundExact } from "../packages/comparator/src/compare.js";
import { PK_SALARY_TAX_NEW as NEW, PK_SALARY_TAX_OLD as OLD } from "../fixtures/policies/pk-salary-tax.js";

type Lang = "en" | "ur";
const T = {
  en: {
    kicker: "For taxpayers",
    title: "Did your tax calculator give you the right answer?",
    sub: "For salaried individuals, tax year 2026-27 (Finance Act 2026). Nothing you type leaves this page.",
    salary: "Your taxable salary",
    calc: "What your calculator said (optional)",
    year: "per year", month: "per month",
    tryx: "Try:",
    law: (y: string, m: string) => `Under the 2026-27 law, your income tax is <b>${y}</b> a year (${m} a month).`,
    zero: "Your salary is not above Rs. 600,000, so no income tax is due.",
    why: (row: string, band: string, base: string, rate: string, over: string) => `Why: your salary falls in slab ${row} (${band}). Tax = ${base} + ${rate}% of the amount above ${over}.`,
    less: (d: string, o: string) => `That is <b>${d} less</b> than under last year's (2025-26) rules, which would have charged ${o}.`,
    same: "That is the same as under last year's (2025-26) rules.",
    more: (d: string, o: string) => `That is ${d} more than under last year's (2025-26) rules (${o}).`,
    surcharge: "Last year's figure includes the 9% surcharge, which the Finance Act 2026 withdrew for salaried persons.",
    ok: "✓ Your calculator's answer matches the 2026-27 law.",
    old: (c: string, y: string, d: string) => `✗ Your calculator seems to be using last year's (2025-26) rules. It told you ${c}; the 2026-27 law says ${y}, a difference of <b>${d} a year</b>.`,
    neither: (c: string, d: string) => `✗ Your calculator's answer (${c}) matches neither year's law. It is off by <b>${d} a year</b>. It may include other items, or it may have a bug.`,
    invalid: "Please enter numbers only.",
    caveat: "Covers basic income tax on salary only (no other income, tax credits or adjustments). This is not legal or tax advice; if in doubt, check with FBR or a tax professional.",
    note: "Copy a note for the calculator's owner",
    copied: "Copied",
    deep: "Test a calculator thoroughly →",
    band: (a: number | null, b: number | null) => (a === null || a === 0 ? `up to Rs. ${fmt(b!)}` : b === null ? `above Rs. ${fmt(a)}` : `Rs. ${fmt(a + 1)} – Rs. ${fmt(b)}`),
  },
  ur: {
    kicker: "ٹیکس دہندگان کے لیے",
    title: "کیا آپ کے ٹیکس کیلکولیٹر نے درست جواب دیا؟",
    sub: "تنخواہ دار افراد کے لیے، ٹیکس سال 2026-27 (فنانس ایکٹ 2026)۔ آپ جو کچھ لکھیں گے وہ اسی صفحے پر رہے گا۔",
    salary: "آپ کی قابلِ ٹیکس تنخواہ",
    calc: "آپ کے کیلکولیٹر نے کتنا ٹیکس بتایا (اختیاری)",
    year: "سالانہ", month: "ماہانہ",
    tryx: "آزمائیں:",
    law: (y: string, m: string) => `2026-27 کے قانون کے مطابق آپ کا انکم ٹیکس <b>${y}</b> سالانہ (${m} ماہانہ) ہے۔`,
    zero: "آپ کی تنخواہ 6 لاکھ روپے سے زیادہ نہیں، اس لیے کوئی انکم ٹیکس نہیں بنتا۔",
    why: (row: string, band: string, base: string, rate: string, over: string) => `وجہ: آپ کی تنخواہ سلیب ${row} (${band}) میں آتی ہے۔ ٹیکس = ${base} + ${over} سے زائد رقم کا ${rate}%۔`,
    less: (d: string, o: string) => `یہ پچھلے سال (2025-26) کے قواعد سے <b>${d} کم</b> ہے، جن کے تحت ${o} بنتا۔`,
    same: "یہ پچھلے سال (2025-26) کے قواعد کے برابر ہے۔",
    more: (d: string, o: string) => `یہ پچھلے سال (2025-26) کے قواعد (${o}) سے ${d} زیادہ ہے۔`,
    surcharge: "پچھلے سال کی رقم میں 9٪ سرچارج شامل ہے، جو فنانس ایکٹ 2026 نے تنخواہ دار افراد کے لیے ختم کر دیا۔",
    ok: "✓ آپ کے کیلکولیٹر کا جواب 2026-27 کے قانون کے مطابق ہے۔",
    old: (c: string, y: string, d: string) => `✗ لگتا ہے آپ کا کیلکولیٹر پچھلے سال (2025-26) کے قواعد استعمال کر رہا ہے۔ اس نے ${c} بتایا؛ 2026-27 کے قانون کے مطابق ${y} بنتا ہے، یعنی <b>سالانہ ${d}</b> کا فرق۔`,
    neither: (c: string, d: string) => `✗ آپ کے کیلکولیٹر کا جواب (${c}) کسی بھی سال کے قانون سے مطابقت نہیں رکھتا؛ <b>سالانہ ${d}</b> کا فرق ہے۔ ممکن ہے اس میں کوئی اور مد شامل ہو، یا اس میں خرابی ہو۔`,
    invalid: "براہِ کرم صرف اعداد درج کریں۔",
    caveat: "یہ صرف تنخواہ پر بنیادی انکم ٹیکس کا حساب ہے (دیگر آمدنی، ٹیکس کریڈٹ یا ایڈجسٹمنٹ شامل نہیں)۔ یہ قانونی یا ٹیکس مشورہ نہیں؛ شک کی صورت میں ایف بی آر یا کسی ٹیکس ماہر سے رجوع کریں۔",
    note: "کیلکولیٹر کے مالک کے لیے پیغام کاپی کریں",
    copied: "کاپی ہو گیا",
    deep: "کیلکولیٹر کی مکمل جانچ کریں ←",
    band: (a: number | null, b: number | null) => (a === null || a === 0 ? `Rs. ${fmt(b!)} تک` : b === null ? `Rs. ${fmt(a)} سے زائد` : `Rs. ${fmt(a + 1)} تا Rs. ${fmt(b)}`),
  },
};

const fmt = (n: number) => n.toLocaleString("en-US");
const rs = (r: Rational) => "Rs. " + fmt(Number(roundExact(r, "half-up").toString()));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** In RTL text, keep years ("2025-26"), percentages and rupee amounts reading left-to-right. Text nodes only. */
const ltr = (html: string) =>
  st.lang !== "ur" ? html : html.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part : part.replace(/Rs\. [\d,]+(?:\.\d+)?|\d{4}-\d{2}|\d+(?:\.\d+)?%/g, (m) => `<bdi dir="ltr">${m}</bdi>`))).join("");

const st = { lang: "en" as Lang, salary: "", salaryMonthly: false, calc: "", calcMonthly: false };

const num = (s: string): Rational | null => {
  const c = s.replace(/[,\s]|rs\.?/gi, "");
  return /^\d+(\.\d+)?$/.test(c) ? Rational.parse(c) : null;
};

export function citizenCard(): string {
  const t = T[st.lang];
  const chip = (on: boolean, attr: string, label: string) => `<button type="button" class="chip mini" ${attr} aria-pressed="${on}">${label}</button>`;
  return ltr(`<div class="citizen" id="taxpayer" lang="${st.lang === "ur" ? "ur" : "en"}" dir="${st.lang === "ur" ? "rtl" : "ltr"}" aria-labelledby="cz-title">
    <div class="cz-top"><span class="cz-kicker">${t.kicker}</span>
      <span class="cz-lang" role="group" aria-label="Language">${chip(st.lang === "en", 'data-cz-lang="en"', "English")}${chip(st.lang === "ur", 'data-cz-lang="ur"', "اردو")}</span></div>
    <h2 id="cz-title">${t.title}</h2>
    <p class="cz-sub">${t.sub}</p>
    <div class="cz-field"><label for="cz-salary">${t.salary}</label>
      <div class="cz-row"><input id="cz-salary" inputmode="numeric" autocomplete="off" placeholder="3,650,000" value="${esc(st.salary)}">
      <span class="cz-unit" role="group" aria-label="${t.salary}">${chip(!st.salaryMonthly, 'data-cz-sal="y"', t.year)}${chip(st.salaryMonthly, 'data-cz-sal="m"', t.month)}</span></div>
      <div class="cz-try">${t.tryx} ${[1_500_000, 3_650_000, 12_000_000].map((v) => `<button type="button" class="linkish" data-cz-try="${v}">${fmt(v)}</button>`).join(" · ")}</div>
    </div>
    <div class="cz-field"><label for="cz-calc">${t.calc}</label>
      <div class="cz-row"><input id="cz-calc" inputmode="numeric" autocomplete="off" placeholder="—" value="${esc(st.calc)}">
      <span class="cz-unit" role="group" aria-label="${t.calc}">${chip(!st.calcMonthly, 'data-cz-calc="y"', t.year)}${chip(st.calcMonthly, 'data-cz-calc="m"', t.month)}</span></div>
    </div>
    <div class="cz-out" id="cz-out" aria-live="polite"></div>
  </div>`);
}

function evaluate() {
  const t = T[st.lang];
  const out = document.getElementById("cz-out");
  if (!out) return;
  if (!st.salary.trim()) { out.innerHTML = `<p class="cz-caveat">${t.caveat}</p>`; return; }
  const s0 = num(st.salary);
  if (!s0) { out.innerHTML = `<p class="cz-bad">${t.invalid}</p>`; return; }
  const x = st.salaryMonthly ? s0.mul(Rational.of(12)) : s0;
  const y = evaluateExact(NEW, x);
  const o = evaluateExact(OLD, x);
  const row = rowFor(NEW, x);
  const lines: string[] = [];
  if (y.isZero()) lines.push(`<p>${t.zero}</p>`);
  else {
    lines.push(`<p class="cz-law">${t.law(rs(y), rs(y.div(Rational.of(12))))}</p>`);
    lines.push(`<p class="cz-why">${t.why(row.row.replace("S. No. ", ""), t.band(row.over, row.upTo), `Rs. ${fmt(row.base)}`, String(+(Number(row.rate) * 100).toFixed(2)), `Rs. ${fmt(row.over)}`)}</p>`);
  }
  const d = roundExact(o, "half-up").sub(roundExact(y, "half-up"));
  if (d.sign() > 0) lines.push(`<p>${t.less(rs(d), rs(o))}</p>`);
  else if (d.sign() < 0) lines.push(`<p>${t.more(rs(d.abs()), rs(o))}</p>`);
  else if (!y.isZero()) lines.push(`<p>${t.same}</p>`);
  if (OLD.surcharge && x.cmp(Rational.of(OLD.surcharge.over)) > 0) lines.push(`<p class="cz-small">${t.surcharge}</p>`);

  let note = "";
  if (st.calc.trim()) {
    const c0 = num(st.calc);
    if (!c0) lines.push(`<p class="cz-bad">${t.invalid}</p>`);
    else {
      const c = st.calcMonthly ? c0.mul(Rational.of(12)) : c0;
      const cmp = compareNumeric(y, c.toDecimalString(), { rounding: "half-up", absoluteTolerance: st.calcMonthly ? 12 : 1 }, o);
      const diff = rs(roundExact(c, "half-up").sub(roundExact(y, "half-up")).abs());
      if (cmp.result === "CONFORMANT") lines.push(`<p class="cz-good">${t.ok}</p>`);
      else {
        lines.push(`<p class="cz-bad">${cmp.attribution === "MATCHES_OLD" ? t.old(rs(c), rs(y), diff) : t.neither(rs(c), diff)}</p>`);
        note = `Hello, your salary tax calculator gave ${rs(c)} as the annual tax for an annual taxable salary of ${rs(x)} in tax year 2026-27. Under the salaried tax table in the Finance Act 2026, tax on this income is ${rs(y)} (the 2025-26 table gives ${rs(o)}). Could you check whether the calculator has been updated for tax year 2026-27? Thank you.`;
      }
    }
  }
  lines.push(`<div class="cz-actions">${note ? `<button type="button" class="btn ghost small" id="cz-note">${t.note}</button>` : ""}<a class="linkish" href="#check">${t.deep}</a></div>`);
  lines.push(`<p class="cz-caveat">${t.caveat}</p>`);
  out.innerHTML = ltr(lines.join(""));
  const nb = document.getElementById("cz-note");
  if (nb) nb.addEventListener("click", async () => { try { await navigator.clipboard.writeText(note); nb.textContent = t.copied; } catch { /* clipboard unavailable */ } });
}

export function wireCitizen() {
  const root = document.getElementById("taxpayer");
  if (!root) return;
  const rerender = () => {
    const tmp = document.createElement("div");
    tmp.innerHTML = citizenCard();
    root.replaceWith(tmp.firstElementChild!);
    wireCitizen();
  };
  root.querySelectorAll<HTMLElement>("[data-cz-lang]").forEach((b) => b.addEventListener("click", () => { st.lang = b.dataset.czLang as Lang; rerender(); document.querySelector<HTMLElement>(`[data-cz-lang="${st.lang}"]`)?.focus(); }));
  root.querySelectorAll<HTMLElement>("[data-cz-sal]").forEach((b) => b.addEventListener("click", () => { st.salaryMonthly = b.dataset.czSal === "m"; rerender(); }));
  root.querySelectorAll<HTMLElement>("[data-cz-calc]").forEach((b) => b.addEventListener("click", () => { st.calcMonthly = b.dataset.czCalc === "m"; rerender(); }));
  root.querySelectorAll<HTMLElement>("[data-cz-try]").forEach((b) => b.addEventListener("click", () => { st.salary = fmt(Number(b.dataset.czTry)); st.salaryMonthly = false; rerender(); }));
  const sal = root.querySelector<HTMLInputElement>("#cz-salary")!;
  const calc = root.querySelector<HTMLInputElement>("#cz-calc")!;
  sal.addEventListener("input", () => { st.salary = sal.value; evaluate(); });
  calc.addEventListener("input", () => { st.calc = calc.value; evaluate(); });
  evaluate();
}

