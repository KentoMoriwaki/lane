import { esbuildPluginFilePathExtensions } from "esbuild-plugin-file-path-extensions";
import { defineConfig } from "tsup";

// `"use client"` is a *file* boundary, so the output has to keep files. A single
// bundle per format makes the directive on any one source module cover the whole
// package, which locks server modules out of the isomorphic half of the API
// (`laneKey`, `laneRead`, `createLane`). Emitting one file per source module —
// what react-query does — lets the five React modules carry the directive and
// leaves the other eight importable from a Server Component.
//
// Every source module is an entry, and the plugin resolves our relative imports
// as *external*, appending the extension of the format being emitted (`./core.js`
// from ESM, `./core.cjs` from CJS). Both halves matter: external is what keeps
// each module its own file instead of inlining shared code into every entry, and
// the extension is what makes the output resolvable at all — Node ESM requires
// one, and a bare `require("./core")` would find the *ESM* `core.js` under this
// package's `"type": "module"`.
//
// This mirrors react-query's own tsup setup, plugin included.
export default defineConfig({
  // `src/*.ts` is not recursive, so `__tests__` is already out.
  entry: ["src/*.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react"],
  esbuildPlugins: [esbuildPluginFilePathExtensions({ esmExtension: "js" })],
});
