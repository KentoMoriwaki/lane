import { Hono } from "hono";
import { COLOCATED_SERVER_REQUEST_HEADER } from "@/lib/team-api";
import {
  delay,
  readMilliseconds,
  requestTransportDelay,
} from "./latency";
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
 * Transport latency depends on whether the caller is a browser or the
 * co-located Next server; endpoint source work is identical for both.
 */

/**
 * Read latency is per endpoint, scaled to the work the endpoint actually does.
 *
 * The point is not realism for its own sake: several of these reads are on screen
 * at the same time, and a workspace refresh re-reads all of them at once. If they
 * all answer in the same 100ms the screen looks the same however a library applies
 * the results, and the pending states the demo exists to show collapse into a
 * single flicker. Spread them the way a real backend would and the difference
 * becomes visible — a filtered list with joins is slower than a label lookup, and
 * an aggregate over the whole board is slower again.
 *
 * These source-work delays are env-configurable and origin-independent.
 * Transport is added separately by the middleware below.
 */
const readDelayMs = readMilliseconds(process.env.TEAM_API_READ_DELAY_MS, 20);
const writeDelayMs = readMilliseconds(process.env.TEAM_API_WRITE_DELAY_MS, 40);
// Selectors behind type-ahead pickers stay snappy.
const pickerDelayMs = readMilliseconds(
  process.env.TEAM_API_PICKER_DELAY_MS,
  15,
);
// The filtered task list: a join and a sort.
const listDelayMs = readMilliseconds(process.env.TEAM_API_LIST_DELAY_MS, 50);
// Insights: a scan of every task in the team.
const aggregateDelayMs = readMilliseconds(
  process.env.TEAM_API_AGGREGATE_DELAY_MS,
  80,
);

const randomFailRate = readRatio(process.env.API_RANDOM_FAIL_RATE);
const randomFailStatus = readStatus(process.env.API_RANDOM_FAIL_STATUS);
const randomFailPathPrefixes = readPathPrefixes(process.env.API_RANDOM_FAIL_PATHS);

const app = new Hono();

app.use("*", async (context, next) => {
  const sourceDelay = readRequestDelay(context.req.method, context.req.path);
  const transportDelay = requestTransportDelay(
    context.req.header(COLOCATED_SERVER_REQUEST_HEADER),
  );
  await delay(sourceDelay + transportDelay);

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

function readRequestDelay(method: string, path: string) {
  if (method !== "GET") {
    return writeDelayMs;
  }

  // Selectors that back type-ahead pickers stay snappy.
  if (path === "/api/labels" || path === "/api/members") {
    return pickerDelayMs;
  }

  if (path === "/api/insights") {
    return aggregateDelayMs;
  }

  // Any task-list query — the filtered board and the dependency panels' by-id
  // lookup both land here. A single task (`/api/tasks/:id`) does not.
  if (path === "/api/tasks") {
    return listDelayMs;
  }

  return readDelayMs;
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
