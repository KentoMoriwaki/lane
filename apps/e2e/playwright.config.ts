import { defineConfig } from "@playwright/test";

const APP_PORT = 3102;
const APP_URL = `http://localhost:${APP_PORT}`;

/**
 * The suite runs against a dedicated apps/demo dev server (port 3102) that
 * serves its own embedded team API from `/api`, backed by a local SQLite file
 * that is removed before each run. Tests exercise the /lane route (the
 * use-lane, RSC-seeded variant). A locally running dev setup on the default
 * ports is never touched.
 */
export default defineConfig({
  testDir: "./tests",
  // Tests mutate one shared workspace database; keep them sequential.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "rm -f apps/demo/data/e2e-team-task.sqlite && pnpm --filter @lane/demo exec next dev -p 3102",
    cwd: "../..",
    url: APP_URL,
    env: {
      // The server-side RPC client (RSC seed) needs an absolute origin; the
      // browser still talks to /api same-origin.
      NEXT_PUBLIC_SITE_URL: APP_URL,
      // A throwaway SQLite file (relative to apps/demo), re-seeded each run.
      TEAM_DB_PATH: "data/e2e-team-task.sqlite",
      // No artificial latency so the suite stays fast and deterministic.
      TEAM_API_READ_DELAY_MS: "0",
      TEAM_API_WRITE_DELAY_MS: "0",
      TEAM_API_PICKER_DELAY_MS: "0",
      TEAM_API_LIST_DELAY_MS: "0",
      TEAM_API_AGGREGATE_DELAY_MS: "0",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
