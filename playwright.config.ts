import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && PORT=4173 DATALINT_USE_IN_MEMORY_DATABASE=\"${DATALINT_USE_IN_MEMORY_DATABASE:-true}\" DATALINT_API_TOKEN='e2e-access-token' DATALINT_ALLOWED_ORIGINS='http://127.0.0.1:4173' npm start",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
