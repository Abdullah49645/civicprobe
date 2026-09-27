/**
 * Builds dist/index.html: one self-contained static file (no network, no
 * server, no external fonts). It embeds the recorded evidence runs and a
 * bundle of the real engine packages so the page can replay any run.
 *
 *   npm run build     → dist/index.html  (deploy the dist/ folder anywhere static)
 */
import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const manifest = JSON.parse(readFileSync("evidence/manifest.json", "utf8"));
const order = ["tax-stale-rate", "tax-correct", "tax-legacy-surcharge", "tax-missing-band", "tax-ignores-year", "tax-branch-typo", "tax-not-updated", "waiver-stale-age", "waiver-correct"];
const files = readdirSync("evidence/runs").filter((f) => f.endsWith(".json"));
const runs = files.map((f) => JSON.parse(readFileSync(`evidence/runs/${f}`, "utf8"))).sort((a, b) => order.indexOf(a.scenario.id) - order.indexOf(b.scenario.id));
if (runs.length !== order.length) throw new Error(`expected ${order.length} evidence runs, found ${runs.length}; run \`npm run evidence\` first`);

const bj = JSON.parse(readFileSync("docs/benchmark.json", "utf8"));
const primary = bj.runs[0];
const shr = primary.results.filter((r: any) => r.shrink && r.family !== "out-of-scope-typo");
const bench = {
  seeds: bj.seeds,
  budgets: bj.budgets,
  domains: bj.runs.map((r: any) => ({ domainMax: r.config.domainMax, summary: r.summary })),
  mutants: primary.results.length,
  equivalent: primary.results.filter((r: any) => r.equivalent).map((r: any) => r.id),
  shrink: { structured: shr.filter((r: any) => r.shrink.structuredExact).length, bisection: shr.filter((r: any) => r.shrink.bisectionExact).length, total: shr.length },
};

const js = await build({ entryPoints: ["ui/app.ts"], bundle: true, format: "iife", target: "es2020", minify: true, write: false, legalComments: "none", platform: "browser" });
const app = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const payload = JSON.stringify({ runs, manifest, bench, builtFrom: "a static build of the committed evidence (scripts/build-ui.ts)" }).replace(/</g, "\\u003c");
const html = readFileSync("ui/template.html", "utf8").replace("__DATA__", () => payload).replace("__APP__", () => app);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(0)} KB (app ${(app.length / 1024).toFixed(0)} KB, ${runs.length} runs)`);
