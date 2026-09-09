import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./popstate",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3103", trace: "retain-on-failure" },
  webServer: {
    command: "node popstate/server.mjs",
    url: "http://127.0.0.1:3103",
    reuseExistingServer: false,
  },
});
