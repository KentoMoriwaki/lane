import { Hono } from "hono";
import { teamRoutes } from "./routes";

/**
 * The embedded team-task API.
 *
 * The same Hono routes that used to run as a standalone Node server now mount
 * inside the demo's Next.js Route Handler (see `app/api/[[...route]]/route.ts`),
 * so the deployed demo is a single Vercel app with no separate backend. Only
 * the libSQL/Turso-backed team routes are mounted here — the legacy
 * `node:sqlite` todo routes are intentionally left out of the serverless path.
 *
 * Artificial latency and random failures are kept (env-configurable) so the
 * pending / optimistic / error states the demo exists to show stay observable.
 * The Playwright suite sets the delays to 0.
 */

// Lightweight selectors (labels / members) stay snappy; everything else gets a
// small read or write delay.
const readDelayMs = readMs(process.env.TEAM_API_READ_DELAY_MS, 100);
const writeDelayMs = readMs(process.env.TEAM_API_WRITE_DELAY_MS, 100);
const pickerDelayMs = readMs(process.env.TEAM_API_PICKER_DELAY_MS, 100);

const randomFailRate = readRatio(process.env.API_RANDOM_FAIL_RATE);
const randomFailStatus = readStatus(process.env.API_RANDOM_FAIL_STATUS);
const randomFailPathPrefixes = readPathPrefixes(process.env.API_RANDOM_FAIL_PATHS);

const app = new Hono();

app.use("*", async (context, next) => {
  await delay(readRequestDelay(context.req.method, context.req.path));

  if (
    shouldRandomlyFail(
      context.req.method,
      context.req.path,
      context.req.header("x-random-fail-bypass"),
    )
  ) {
    return context.json(
      { error: "Random API failure", code: "random_failure" },
      randomFailStatus,
    );
  }

  await next();
});

export const routes = app.route("/api", teamRoutes);

export type AppType = typeof routes;

export { app };

async function delay(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readRequestDelay(method: string, path: string) {
  // Selectors that back type-ahead pickers stay snappy.
  if ((path === "/api/labels" || path === "/api/members") && method === "GET") {
    return pickerDelayMs;
  }

  return method === "GET" ? readDelayMs : writeDelayMs;
}

function shouldRandomlyFail(
  method: string,
  path: string,
  bypassHeader: string | undefined,
) {
  if (randomFailRate <= 0 || method === "OPTIONS") {
    return false;
  }

  if (bypassHeader === "1" || bypassHeader === "true") {
    return false;
  }

  if (
    randomFailPathPrefixes.length > 0 &&
    !randomFailPathPrefixes.some((prefix) => path.startsWith(prefix))
  ) {
    return false;
  }

  return Math.random() < randomFailRate;
}

function readMs(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readRatio(value: string | undefined) {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(parsed, 1));
}

function readStatus(value: string | undefined) {
  const parsed = Number(value ?? 503);

  if (!Number.isInteger(parsed) || parsed < 400 || parsed > 599) {
    return 503;
  }

  return parsed as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
}

function readPathPrefixes(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}
