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

// The lab dataset lives in module scope, and the encoder uses `Buffer`.
export const runtime = "nodejs";
// Nothing about this endpoint is static; it is a live, mutable dataset.
export const dynamic = "force-dynamic";

const handler = handle(feedRoutes);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
