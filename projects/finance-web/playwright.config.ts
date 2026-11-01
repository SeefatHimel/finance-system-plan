import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/quality",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3039",
    trace: "retain-on-failure",
    extraHTTPHeaders: { "x-quality-client-ip": "192.0.2.45" },
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {},
  },
  projects: [{name:"desktop",use:{...devices["Desktop Chrome"]}}, {name:"mobile",use:{...devices["Pixel 7"],browserName:"chromium"}}],
});
