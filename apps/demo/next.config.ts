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
};

export default nextConfig;
