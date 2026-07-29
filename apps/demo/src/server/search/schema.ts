import { z } from "zod";

/**
 * Wire contract for the cancel lab's search endpoint (`/api/search`).
 *
 * Like `server/feed/*`, this is deliberately not part of the team-task API: the
 * lab owns its own timing, and the team app wraps every route in artificial
 * latency it does not control. Nothing here touches `server/team/*`.
 *
 * The client imports the types with `import type`, so no zod and no server
 * runtime reaches the browser bundle.
 */

export const searchQuerySchema = z.object({
  q: z.string().default(""),
  /** Per-request, because the lab changes it between keystrokes. */
  latency: z.coerce.number().int().min(0).max(10_000).default(800),
});

export type SearchRow = {
  id: string;
  title: string;
  project: string;
};

export type SearchResponse = {
  /** Echoed back so a late response can be attributed to the query that asked. */
  q: string;
  /** Process-wide counter stamped at serve time — the order the server saw. */
  seq: number;
  servedAt: string;
  latencyMs: number;
  total: number;
  rows: SearchRow[];
};

/**
 * What the *server* saw, which is not what the client saw.
 *
 * Aborting a `fetch` closes the connection; whether the server then stops
 * working is a property of the stack, not of the abort. This route propagates
 * the request signal into its own delay, so `abandoned` counts the requests it
 * actually dropped — the difference between "the client stopped waiting" and
 * "the work stopped".
 */
export type SearchStats = {
  served: number;
  abandoned: number;
};
