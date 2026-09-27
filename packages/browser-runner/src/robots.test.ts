import { test } from "node:test";
import assert from "node:assert/strict";
import { robotsAllows } from "./robots.js";

test("robots: star group disallow, longer allow wins, specific agent group preferred", () => {
  const txt = "User-agent: *\nDisallow: /services/\nAllow: /services/salary-tax-calculator\n\nUser-agent: civicprobe\nDisallow: /";
  assert.equal(robotsAllows(txt, "/services/salary-tax-calculator", "other"), true);
  assert.equal(robotsAllows(txt, "/services/x", "other"), false);
  assert.equal(robotsAllows(txt, "/anything", "civicprobe"), false);
  assert.equal(robotsAllows("", "/x"), true);
});
