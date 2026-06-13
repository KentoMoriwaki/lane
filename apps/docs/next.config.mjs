import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextra from "nextra";

const appDir = dirname(fileURLToPath(import.meta.url));

const withNextra = nextra({
  search: {
    codeblocks: false,
  },
});

export default withNextra({
  reactStrictMode: true,
  turbopack: {
    root: resolve(appDir, "../.."),
  },
});
