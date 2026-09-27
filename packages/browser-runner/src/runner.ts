import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { sleep, type RunnerConfig } from "./config.js";

/**
 * A responsible wrapper around Playwright. Every adapter gets, for free:
 *  - a minimum delay between page loads and a hard cap per run;
 *  - a read-only network guard: main-frame navigation off the allowed
 *    origins is aborted, and state-changing requests (POST/PUT/PATCH/DELETE)
 *    to anything other than the allowed origins are aborted and counted.
 * Playwright is the execution mechanism, not the product.
 */
export class BrowserRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private loads = 0;
  private lastLoadAt = 0;
  readonly blocked: string[] = [];

  constructor(private config: RunnerConfig, private allowedOrigins: string[]) {}

  static async chromiumVersion(): Promise<string> {
    const b = await chromium.launch();
    const v = b.version();
    await b.close();
    return v;
  }

  async page(): Promise<Page> {
    if (!this.browser) this.browser = await chromium.launch();
    if (!this.context) {
      this.context = await this.browser.newContext({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC" });
      await this.context.route("**/*", (route) => {
        const req = route.request();
        const origin = safeOrigin(req.url());
        const allowed = origin !== null && this.allowedOrigins.includes(origin);
        const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method());
        if ((req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame() && !allowed) || (mutating && !allowed)) {
          this.blocked.push(`${req.method()} ${req.url()}`);
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
    }
    const pages = this.context.pages();
    const page = pages[0] ?? (await this.context.newPage());
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    page.setDefaultTimeout(this.config.actionTimeoutMs);
    return page;
  }

  /** Call before every page load. Throws past the cap; callers turn that into EXECUTION_FAILURE. */
  async throttle(): Promise<void> {
    if (this.loads >= this.config.maxRequestsPerRun) throw new Error(`rate cap: ${this.config.maxRequestsPerRun} page loads reached for this run`);
    const wait = this.config.minDelayMs - (Date.now() - this.lastLoadAt);
    if (wait > 0) await sleep(wait);
    this.loads += 1;
    this.lastLoadAt = Date.now();
  }

  get pageLoads(): number {
    return this.loads;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }
}

function safeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "about:") return u.protocol;
    return u.origin;
  } catch {
    return null;
  }
}
