import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

/**
 * The built viewer (dist/index.html) exercised in real Chromium: the
 * taxpayer check, the live calculator check, and in-page replay. Values are
 * checked against KPMG's published figures and the recorded evidence.
 */
const file = resolve("dist/index.html");
let browser: Browser;
let page: Page;
const errors: string[] = [];

before(async () => {
  assert.ok(existsSync(file), "run `npm run build` first");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + file);
});
after(async () => { await browser?.close(); });

const out = async () => (await page.textContent("#cz-out"))!.replace(/\s+/g, " ");

test("taxpayer check: 12,000,000 → Rs. 3,174,000 under 2026-27 vs Rs. 3,685,290 under 2025-26 (KPMG values)", async () => {
  await page.fill("#cz-salary", "12,000,000");
  const t = await out();
  assert.match(t, /Rs\. 3,174,000 a year/);
  assert.match(t, /Rs\. 3,685,290/);
  assert.match(t, /surcharge/);
});

test("taxpayer check: a calculator still on last year's law is identified as such", async () => {
  await page.fill("#cz-salary", "3,650,000");
  await page.fill("#cz-calc", "481,000");
  assert.match(await out(), /using last year's \(2025-26\) rules.*Rs\. 52,500 a year/);
  await page.fill("#cz-calc", "428,500");
  assert.match(await out(), /matches the 2026-27 law/);
  await page.fill("#cz-calc", "430,000");
  assert.match(await out(), /matches neither year's law/);
});

test("taxpayer check: monthly figures are compared correctly", async () => {
  await page.click('[data-cz-calc="m"]');
  await page.fill("#cz-calc", "35,708");
  assert.match(await out(), /matches the 2026-27 law/);
  await page.click('[data-cz-calc="y"]');
});

test("taxpayer check: Urdu mode is right-to-left and keeps the computed values", async () => {
  await page.fill("#cz-calc", "");
  await page.click('[data-cz-lang="ur"]');
  assert.equal(await page.getAttribute("#taxpayer", "dir"), "rtl");
  assert.match(await out(), /Rs\. 428,500/);
  await page.click('[data-cz-lang="en"]');
});

test("live check: a fixture's answers are diagnosed to the single missed edit", async () => {
  await page.selectOption("#live-demo", "missing-band");
  const t = (await page.textContent("#live-summary"))!;
  assert.match(t, /exactly one reproduces all 19 answers/);
  assert.match(t, /7,000,000 never added/);
  await page.selectOption("#live-demo", "none");
  assert.match((await page.textContent("#live-summary"))!, /All 19 answers conform/);
});

test("replay: the in-page engine reproduces the recorded run's digest", async () => {
  await page.click("#replay-run");
  await page.waitForSelector("#replay-out table", { timeout: 30_000 });
  const t = (await page.textContent("#replay-out"))!;
  assert.equal((t.match(/matches/g) ?? []).length, 4);
  assert.doesNotMatch(t, /DIFFERS/);
});

test("no console errors and no horizontal overflow on a phone", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  assert.deepEqual(errors, []);
});
