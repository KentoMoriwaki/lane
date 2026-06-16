import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";
import { createSchema, createYoga } from "graphql-yoga";
import { buildContext, resolvers, type GraphQLContext } from "./resolvers";

/**
 * The embedded GraphQL endpoint for the Relay variant.
 *
 * `schema.graphql` is the single source of truth — read here at module init and
 * type-checked by relay-compiler. The `useDeferStream` plugin turns `@defer`
 * into real incremental delivery (a `multipart/mixed` response), so a query that
 * defers `insights` streams the shell first and the counters a moment later —
 * the behavior the Relay network layer in `app/relay/api/environment.ts` parses.
 */

// `outputFileTracingIncludes` (next.config.ts) ships this file with the
// serverless function; `process.cwd()` is the app root in dev and on Vercel.
const typeDefs = readFileSync(
  join(process.cwd(), "src/server/graphql/schema.graphql"),
  "utf8",
);

export const yoga = createYoga({
  schema: createSchema<GraphQLContext>({ typeDefs, resolvers }),
  graphqlEndpoint: "/api/graphql",
  // Use the platform Response so @defer streaming uses the runtime's
  // ReadableStream instead of a polyfill.
  fetchAPI: { Response },
  plugins: [useDeferStream()],
  context: ({ request }) => buildContext(request.headers),
  // The demo has no CSRF surface; Relay sends application/json POSTs.
  cors: false,
});
