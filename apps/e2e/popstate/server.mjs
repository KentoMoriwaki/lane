import { build } from "esbuild";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: ["popstate/app.tsx"],
  bundle: true,
  write: false,
  format: "esm",
  jsx: "automatic",
  // One pinned React, including imports from the workspace library source.
  alias: {
    react: dirname(require.resolve("react/package.json")),
    "react-dom": dirname(require.resolve("react-dom/package.json")),
  },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.REACT_MODE ?? "development") },
});

createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/app.js" ? outputFiles[0].text :
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
}).listen(3103, "127.0.0.1");
