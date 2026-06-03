import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./tests/env";

/**
 * Serial, single-worker: the suite drives one stateful app instance against live
 * cloud infra (Supabase/Vercel/UAZAPI/OpenAI). The dev server (vercel dev) is started
 * manually per phase, so reuseExistingServer is on and there is no managed webServer.
 */
export default defineConfig({
  testDir: "./tests/specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "tests/report", open: "never" }],
  ],
  outputDir: "tests/test-results",
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "on",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
