import { handle } from "hono/vercel";
import { feedRoutes } from "@/server/feed/app";

/**
 * Route Handler for the infinite-scroll lab's feed API.
 *
 * A dedicated `/api/feed/*` segment takes precedence over the optional
 * catch-all that mounts the team REST API, the same way `/api/graphql` does.
 * That is deliberate: the team app wraps everything it serves in artificial
 * latency and an optional random-failure middleware, and the lab has to own its
 * own timing. Mounting here keeps the two apps completely independent.
 */

// Cache Components uses the Node runtime and executes Route Handlers at request
// time by default. The live, module-scoped dataset therefore needs no segment
// config.

const handler = handle(feedRoutes);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
