import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  searchQuerySchema,
  type SearchResponse,
  type SearchRow,
  type SearchStats,
} from "./schema";

/**
 * The cancel lab's API, mounted at `/api/search`.
 *
 * A separate Hono app for the same reason `server/feed/app.ts` is one: the team
 * API wraps every route in artificial latency the lab cannot control, and every
 * measurement here is about *when* a request stops. Latency is a per-request
 * query parameter so the lab can change it while a read is already in flight.
 *
 * The route propagates the incoming request's signal into its own delay. That
 * makes the one honest claim about server-side cancellation the lab can make:
 * aborting a `fetch` only stops the *client* unless the server bothers to look,
 * and `/stats` reports how often this one did.
 */

const validationHook = (
  result: { success: boolean; error?: { message: string } },
  context: { json: (body: unknown, status: 400) => Response },
) => {
  if (!result.success) {
    return context.json(
      {
        error: result.error?.message ?? "Invalid request",
        code: "invalid_request",
      },
      400,
    );
  }
};

// A fixed, deterministic dataset. The rows are scenery — the lab is measuring
// request lifetimes, not relevance — but they have to respond to the query so
// that "which query is on screen" is readable at a glance.
const SUBJECTS = [
  "Billing",
  "Onboarding",
  "Search",
  "Scheduler",
  "Webhooks",
  "Analytics",
  "Notifications",
  "Permissions",
  "Importer",
  "Dashboard",
];
const ACTIONS = [
  "retry backoff",
  "empty state",
  "audit trail",
  "rate limit",
  "cold start",
  "pagination",
  "timezone handling",
  "error copy",
  "cache headers",
  "keyboard nav",
];
const PROJECTS = ["Platform", "Growth", "Infra", "Design systems"];

const ROWS: SearchRow[] = SUBJECTS.flatMap((subject, subjectIndex) =>
  ACTIONS.map((action, actionIndex) => {
    const index = subjectIndex * ACTIONS.length + actionIndex;

    return {
      id: `row-${index}`,
      title: `${subject} ${action}`,
      project: PROJECTS[index % PROJECTS.length],
    };
  }),
);

const MAX_ROWS = 25;

let sequence = 0;
const stats: SearchStats = { served: 0, abandoned: 0 };

/**
 * Resolves normally, or rejects as soon as the client goes away. The rejection
 * is what makes an abandoned request cost the server nothing but the timer it
 * already had.
 */
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);

    function finish(): void {
      signal.removeEventListener("abort", abandon);
      clearTimeout(timer);
      resolve();
    }

    function abandon(): void {
      clearTimeout(timer);
      reject(new Error("client disconnected"));
    }

    signal.addEventListener("abort", abandon, { once: true });
  });
}

function search(q: string): SearchRow[] {
  const needle = q.trim().toLowerCase();

  if (!needle) {
    return ROWS.slice(0, MAX_ROWS);
  }

  return ROWS.filter((row) =>
    row.title.toLowerCase().includes(needle),
  ).slice(0, MAX_ROWS);
}

const rows = new Hono();

// The lab is measuring the network, so nothing here may be cached by the
// browser, a proxy, or Next's fetch cache.
rows.use("*", async (context, next) => {
  await next();
  context.header("cache-control", "no-store, max-age=0");
});

rows
  .get(
    "/rows",
    zValidator("query", searchQuerySchema, validationHook),
    async (context) => {
      const query = context.req.valid("query");

      try {
        await delay(query.latency, context.req.raw.signal);
      } catch {
        stats.abandoned += 1;
        // The connection is already gone; the body is never read. Returning
        // rather than throwing keeps this off the server's error log. 499
        // ("client closed request") is outside Hono's status union, so this is
        // a raw Response — the status is documentation, not a contract.
        return new Response(null, { status: 499 });
      }

      const rows = search(query.q);
      stats.served += 1;

      const body: SearchResponse = {
        q: query.q,
        seq: ++sequence,
        servedAt: new Date().toISOString(),
        latencyMs: query.latency,
        total: rows.length,
        rows,
      };

      return context.json(body, 200);
    },
  )
  .get("/stats", (context) => context.json(stats satisfies SearchStats, 200))
  .delete("/stats", (context) => {
    stats.served = 0;
    stats.abandoned = 0;

    return context.json(stats satisfies SearchStats, 200);
  });

// `hono/vercel` hands the handler the request's full pathname, so the routes
// have to be mounted at the path the Route Handler is served from — the same
// shape as `server/feed/app.ts`.
const app = new Hono();

export const searchRoutes = app.route("/api/search", rows);
