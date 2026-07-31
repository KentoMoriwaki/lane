import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(appDir, "../.."),
  },
  transpilePackages: ["use-lane"],
  // The lab exists to observe the router bfcache `<Activity>` keep-alive, which
  // only engages under `cacheComponents` — never toggle this off.
  cacheComponents: true,
  // `LAB_PARTIAL_PREFETCH=0 pnpm dev` observes /bfcache without partial
  // prefetching; every other value (including unset) keeps the default on.
  partialPrefetching: process.env.LAB_PARTIAL_PREFETCH !== "0",
};

export default nextConfig;
