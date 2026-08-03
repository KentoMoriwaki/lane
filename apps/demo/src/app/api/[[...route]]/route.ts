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

// Cache Components uses the Node runtime and executes Route Handlers at request
// time by default, so the legacy `runtime` / `dynamic` config is unnecessary.
// The first request after a cold start runs the one-time schema init + seed
// against Turso; give it headroom beyond the default function timeout.
export const maxDuration = 30;

const handler = handle(routes);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
