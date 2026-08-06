import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(appDir, "../.."),
  },
  transpilePackages: ["use-lane"],
  // Off on purpose, and never to be turned back on: the lab counts loader calls
  // and subscribers, and a double mount makes both unreadable.
  reactStrictMode: false,
};

export default nextConfig;
