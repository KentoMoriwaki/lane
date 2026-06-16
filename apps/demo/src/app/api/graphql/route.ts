import { yoga } from "@/server/graphql/yoga";

/**
 * Route Handler for the embedded GraphQL endpoint (the Relay variant's backend).
 *
 * A dedicated `/api/graphql` segment takes precedence over the optional
 * catch-all that mounts the Hono REST API, so the two backends coexist in one
 * app. graphql-yoga is a Web `fetch` handler; we hand each method straight to it.
 */

// libSQL/Turso + the seed run in Node, never the Edge runtime.
export const runtime = "nodejs";
// The workspace is per-request, seeded from a database; never prerender it.
export const dynamic = "force-dynamic";
// The first request after a cold start runs the one-time schema init + seed.
export const maxDuration = 30;

async function handler(request: Request): Promise<Response> {
  return yoga.handleRequest(request, {});
}

export { handler as GET, handler as POST, handler as OPTIONS };
