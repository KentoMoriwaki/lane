import { defineConfig } from "@playwright/test";

const API_PORT = 4100;
const APP_PORT = 3102;
const API_URL = `http://localhost:${API_PORT}`;
const APP_URL = `http://localhost:${APP_PORT}`;

/**
 * The suite runs against a dedicated API instance (port 4100) with its own
 * SQLite file that is removed before each run, and a dedicated apps/demo dev
 * server (port 3102) pointed at it. Tests exercise the /lane route (the
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
  webServer: [
    {
      command:
        "rm -f apps/todo-api/data/e2e-team-task.sqlite && pnpm --filter @lane/todo-api dev",
      cwd: "../..",
      url: `${API_URL}/health`,
      env: {
        PORT: String(API_PORT),
        TEAM_DB_PATH: "data/e2e-team-task.sqlite",
        TEAM_API_READ_DELAY_MS: "0",
        TEAM_API_WRITE_DELAY_MS: "0",
        TEAM_API_PICKER_DELAY_MS: "0",
        TODO_API_DELAY_MS: "0",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @lane/demo exec next dev -p 3102",
      cwd: "../..",
      url: APP_URL,
      env: {
        NEXT_PUBLIC_TODO_API_URL: API_URL,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
