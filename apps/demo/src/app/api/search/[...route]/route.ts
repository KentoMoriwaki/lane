import { handle } from "hono/vercel";
import { searchRoutes } from "@/server/search/app";

/**
 * Route Handler for the cancel lab's search API.
 *
 * A dedicated `/api/search/*` segment takes precedence over the optional
 * catch-all that mounts the team REST API, the same way `/api/feed` and
 * `/api/graphql` do. The team app wraps everything it serves in artificial
 * latency and an optional random-failure middleware, and this lab has to own
 * its own timing exactly.
 */

// Cache Components uses the Node runtime and executes Route Handlers at request
// time by default. The module-scoped dataset and counters stay request-driven
// without segment config.

const handler = handle(searchRoutes);

export const GET = handler;
export const DELETE = handler;
export const OPTIONS = handler;
