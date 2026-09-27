import http, { type Server } from "node:http";
import { TAX_FAULTS, vendorAnnualTax, vendorWaiver, WAIVER_FAULTS, type TaxFault, type WaiverFault } from "./vendor-calculator.js";

/**
 * Local fixture services. Plain server-rendered HTML forms (GET), shaped like
 * the public calculators they stand in for: a tax-year dropdown, an income
 * field, a result sentence that contains MORE than one number (annual and
 * monthly), so the adapter must parse the right one.
 *
 * Every page states it is a DEMO FIXTURE and names the seeded fault.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number) => n.toLocaleString("en-US");

function shell(title: string, banner: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f6f8;color:#1c2733}
header{background:#1d4e3f;color:#fff;padding:14px 22px}header b{font-size:18px}
.banner{background:#fff4d6;border-bottom:1px solid #e0c46c;padding:8px 22px;font-size:13px}
main{max-width:560px;margin:26px auto;background:#fff;border:1px solid #d5dde5;border-radius:6px;padding:22px}
label{display:block;font-size:14px;margin:12px 0 4px}input,select{font:inherit;padding:8px;width:100%;box-sizing:border-box}
button{margin-top:16px;font:inherit;padding:9px 18px;background:#1d4e3f;color:#fff;border:0;border-radius:4px}
#result{margin-top:20px;padding:14px;background:#eef6f2;border-left:4px solid #1d4e3f}</style></head>
<body><header><b>${esc(title)}</b></header><div class="banner">DEMO FIXTURE — ${esc(banner)}</div><main>${body}</main></body></html>`;
}

export function createTaxServer(fault: TaxFault, opts: { offerTy2027?: boolean } = {}): Server {
  const offer2027 = opts.offerTy2027 ?? true;
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const years = offer2027 ? ["2026-27", "2025-26"] : ["2025-26", "2024-25"];
    const year = (url.searchParams.get("year") ?? years[0]) as "2025-26" | "2026-27";
    const incomeRaw = url.searchParams.get("income");
    let result = "";
    if (url.pathname === "/calculate" && incomeRaw !== null) {
      const income = Number(incomeRaw);
      if (Number.isFinite(income) && income >= 0) {
        const tax = vendorAnnualTax(income, year, fault);
        result = `<div id="result" role="status">Tax year ${esc(year)}: annual income tax <strong>Rs. ${money(tax)}</strong> (about Rs. ${money(Math.round(tax / 12))} per month)</div>`;
      } else {
        result = `<div id="result" role="status">Please enter a valid income.</div>`;
      }
    }
    const banner = fault === "none" ? "correct implementation, no seeded fault" : `INTENTIONALLY SEEDED FAULT: ${TAX_FAULTS[fault].title}`;
    const body = `<form method="GET" action="/calculate">
<label for="year">Tax year</label><select id="year" name="year">${years.map((y) => `<option${y === year ? " selected" : ""}>${y}</option>`).join("")}</select>
<label for="income">Annual taxable salary (Rs.)</label><input id="income" name="income" type="number" min="0" step="1" value="${esc(incomeRaw ?? "")}">
<button id="calc" type="submit">Calculate tax</button></form>${result}`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(shell("Salary Tax Calculator", banner, body));
  });
}

export function createWaiverServer(fault: WaiverFault): Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const age = url.searchParams.get("age");
    const income = url.searchParams.get("income");
    let result = "";
    if (url.pathname === "/check" && age !== null && income !== null) {
      const outcome = vendorWaiver(Number(age), Number(income), fault);
      result = `<div id="result" role="status">Result: <strong>${outcome}</strong> for the senior fee waiver.</div>`;
    }
    const banner = fault === "none" ? "invented policy, correct implementation" : `invented policy, INTENTIONALLY SEEDED FAULT: ${WAIVER_FAULTS[fault].title}`;
    const body = `<form method="GET" action="/check">
<label for="age">Age (years)</label><input id="age" name="age" type="number" value="${esc(age ?? "")}">
<label for="hh">Annual household income (Rs.)</label><input id="hh" name="income" type="number" value="${esc(income ?? "")}">
<button id="check" type="submit">Check eligibility</button></form>${result}`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(shell("Senior Fee Waiver Screener", banner, body));
  });
}

export function listen(server: Server): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
