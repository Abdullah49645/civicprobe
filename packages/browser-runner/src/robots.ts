/**
 * Minimal robots.txt check for the live-target script: honours Disallow
 * rules in the `*` group (and a CivicProbe-specific group if present). This
 * is a courtesy gate, not a legal analysis — docs/responsible-testing.md
 * also requires a human to read the target's terms.
 */
export function robotsAllows(robotsTxt: string, path: string, agent = "civicprobe"): boolean {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let cur: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === "disallow" && val) cur.disallow.push(val);
      if (key === "allow" && val) cur.allow.push(val);
    }
  }
  const pick = groups.find((g) => g.agents.includes(agent)) ?? groups.find((g) => g.agents.includes("*"));
  if (!pick) return true;
  const match = (rule: string) => path.startsWith(rule.replace(/\*$/, ""));
  const longestAllow = Math.max(-1, ...pick.allow.filter(match).map((r) => r.length));
  const longestDisallow = Math.max(-1, ...pick.disallow.filter(match).map((r) => r.length));
  return longestAllow >= longestDisallow;
}
