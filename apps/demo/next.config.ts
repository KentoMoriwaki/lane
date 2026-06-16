import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
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
