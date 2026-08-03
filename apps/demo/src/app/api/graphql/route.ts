import { yoga } from "@/server/graphql/yoga";

/**
 * Route Handler for the embedded GraphQL endpoint (the Relay variant's backend).
 *
 * A dedicated `/api/graphql` segment takes precedence over the optional
 * catch-all that mounts the Hono REST API, so the two backends coexist in one
 * app. graphql-yoga is a Web `fetch` handler; we hand each method straight to it.
 */

// Cache Components uses the Node runtime and executes Route Handlers at request
// time by default, so the legacy `runtime` / `dynamic` config is unnecessary.
// The first request after a cold start runs the one-time schema init + seed.
export const maxDuration = 30;

async function handler(request: Request): Promise<Response> {
  return yoga.handleRequest(request, {});
}

export { handler as GET, handler as POST, handler as OPTIONS };
