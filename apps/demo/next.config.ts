import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep these explicit while the 16.3 APIs are in preview. Cache Components
  // extracts each route's reusable shell; Partial Prefetching lets visible
  // links fetch that shared shell without resolving URL-dependent data.
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Keep viewport prefetching bounded to one App Shell per route, then let
    // selected workspace links upgrade to a full runtime prefetch on intent.
    dynamicOnHover: true,
    // `@next/playwright` needs the navigation lock compiled into production.
    // Keep it out of deployed builds; the E2E server opts in explicitly.
    exposeTestingApiInProductionBuild:
      process.env.NEXT_INSTANT_TEST === "1",
  },
  turbopack: {
    root: resolve(appDir, "../.."),
  },
  transpilePackages: ["use-lane"],
  // The embedded API talks to libSQL/Turso from the Node runtime. Keep the
  // client external so Next requires it at runtime instead of bundling its
  // native/optional dependencies.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Rewrite the Relay variant's `graphql` tagged literals to import the
  // artifacts relay-compiler writes under `app/relay/__generated__`. The SWC
  // transform runs under both webpack and Turbopack.
  compiler: {
    relay: {
      src: "./src",
      language: "typescript",
      artifactDirectory: "./src/app/relay/__generated__",
      eagerEsModules: true,
    },
  },
  // The GraphQL schema is read from disk at runtime by graphql-yoga; ship it
  // with the serverless function on Vercel.
  outputFileTracingIncludes: {
    "/api/graphql": ["./src/server/graphql/schema.graphql"],
  },
};

export default nextConfig;
