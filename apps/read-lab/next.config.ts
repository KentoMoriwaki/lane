import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(appDir, "../.."),
  },
  transpilePackages: ["use-lane"],
  // On, which is Next's default and how an app actually runs. It was off here at
  // first, on the inherited assumption that a double mount makes the loader
  // count unreadable — it does not: the second render reuses the cache, and the
  // subscribe → cleanup → subscribe cycle leaves the entry held. So a doubled
  // count under StrictMode is a finding, not noise. The rig wants the harder
  // conditions, because "an unsubscribe and a resubscribe in one task collect
  // nothing" is a promise this is the only place to watch React actually keep.
  reactStrictMode: true,
};

export default nextConfig;
