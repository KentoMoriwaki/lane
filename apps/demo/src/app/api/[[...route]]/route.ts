import { handle } from "hono/vercel";
import { routes } from "@/server/team/app";

/**
 * Catch-all Route Handler for the embedded team-task API.
 *
 * `hono/vercel`'s `handle` adapts the Hono app to the Web `Request`/`Response`
 * signature App Router route handlers use. The optional catch-all segment
 * (`[[...route]]`) forwards every `/api/*` request to Hono, which matches them
 * against the routes mounted in `@/server/team/app`.
 */

// libSQL/Turso and the seed run in Node, not the Edge runtime.
export const runtime = "nodejs";
// The workspace is per-request, seeded from a database; never prerender it.
export const dynamic = "force-dynamic";
// The first request after a cold start runs the one-time schema init + seed
// against Turso; give it headroom beyond the default function timeout.
export const maxDuration = 30;

const handler = handle(routes);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
