import { defineConfig } from "@playwright/test";

const APP_PORT = 3102;
const APP_URL = `http://localhost:${APP_PORT}`;

/**
 * The suite runs against a dedicated apps/demo production server (port 3102)
 * so Cache Components, Partial Prefetching, and the prefetched App Shell are
 * exercised with their deployed behavior. The server
 * serves its own embedded team API from `/api`, backed by a local SQLite file
 * that is removed before each run. Tests exercise the two server-owned routes
 * plus the browser-owned SPA pair and React Query's RSC convergence lab. A
 * locally running dev setup on the default ports is never touched.
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
      "rm -f apps/demo/data/e2e-team-task.sqlite && pnpm --filter @lane/demo build && pnpm --filter @lane/demo exec next start -p 3102",
    cwd: "../..",
    url: APP_URL,
    env: {
      // The server-side RPC client (RSC seed) needs an absolute origin; the
      // browser still talks to /api same-origin.
      NEXT_PUBLIC_SITE_URL: APP_URL,
      // A throwaway SQLite file (relative to apps/demo), re-seeded each run.
      TEAM_DB_PATH: "data/e2e-team-task.sqlite",
      // Keep source work identical and deterministic. Browser transport stays
      // visibly slower than the co-located server without making the SPA
      // ownership checks spend seconds on each bootstrap wave.
      TEAM_API_READ_DELAY_MS: "0",
      TEAM_API_WRITE_DELAY_MS: "0",
      TEAM_API_PICKER_DELAY_MS: "0",
      TEAM_API_LIST_DELAY_MS: "0",
      TEAM_API_AGGREGATE_DELAY_MS: "0",
      TEAM_API_DERIVED_DELAY_MS: "0",
      TEAM_API_BROWSER_TRANSPORT_DELAY_MS: "100",
      TEAM_API_SERVER_TRANSPORT_DELAY_MS: "0",
      // Compile Next's production-only navigation lock used by `instant()`.
      NEXT_INSTANT_TEST: "1",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
