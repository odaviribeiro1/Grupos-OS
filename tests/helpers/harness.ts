/**
 * Shared spec harness: a `test` fixture that captures console/page/network errors and
 * exposes timing + screenshot helpers. Per the brief: every route reports load time,
 * flag > 2s; screenshots per screen; console/network errors surfaced per test.
 */
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SHOT_DIR = resolve(process.cwd(), "tests", "screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

export type Diagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

export const test = base.extend<{ diag: Diagnostics }>({
  diag: async ({ page }, use, testInfo) => {
    const diag: Diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
    page.on("console", (msg) => {
      if (msg.type() === "error") diag.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => diag.pageErrors.push(err.message));
    page.on("requestfailed", (req) => {
      const f = req.failure();
      diag.failedRequests.push(`${req.method()} ${req.url()} — ${f?.errorText ?? "failed"}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 500) diag.failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    });
    await use(diag);
    // Attach diagnostics to the report for every test.
    await testInfo.attach("diagnostics", {
      body: JSON.stringify(diag, null, 2),
      contentType: "application/json",
    });
  },
});

export { expect };

/** Navigate and measure load time. Flags > 2000ms (does not fail — records). */
export async function gotoTimed(
  page: Page,
  path: string,
  testInfo: TestInfo,
  waitUntil: "load" | "domcontentloaded" | "networkidle" = "networkidle"
): Promise<number> {
  const t0 = Date.now();
  await page.goto(path, { waitUntil });
  const ms = Date.now() - t0;
  const flag = ms > 2000 ? " ⚠️ >2s" : "";
  await testInfo.attach(`timing:${path}`, {
    body: `${path} carregou em ${ms}ms${flag}`,
    contentType: "text/plain",
  });
  // eslint-disable-next-line no-console
  console.log(`[timing] ${path} = ${ms}ms${flag}`);
  return ms;
}

/** Save a named screenshot into tests/screenshots and attach it to the report. */
export async function shot(page: Page, name: string, testInfo: TestInfo): Promise<string> {
  const file = resolve(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
  return file;
}
