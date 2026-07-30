import { defineConfig } from "tsup";
import type { Options } from "tsup";

// tsup does not export its `Plugin` type, only the option that takes one.
type TsupPlugin = NonNullable<Options["plugins"]>[number];

// `"use client"` is a *file* boundary, so the output has to keep files. A single
// bundle per format makes the directive on any one source module cover the whole
// package, which locks server modules out of the isomorphic half of the API
// (`laneKey`, `laneRead`, `createLane`). Emitting one file per source module —
// what react-query does — lets the five React modules carry the directive and
// leaves the other eight importable from a Server Component.
//
// `bundle: false` is the mechanism: esbuild runs in transform mode, so imports
// between our modules survive as imports instead of being inlined, and each
// file's directive prologue survives with it.
//
// Transform mode copies specifiers through verbatim, and ours are written
// extensionless (`./core`). Node resolves that in neither format: ESM requires
// the extension spelled out, and CJS would find `core.js` — which is ESM, under
// this package's `"type": "module"`. So point every emitted file at the siblings
// of its own format. tsup's `dts` step already does exactly this for
// `.d.ts` / `.d.cts`; this is the same rewrite for the runtime files.
const RELATIVE_SPECIFIER =
  /(\b(?:from|import|require)\s*\(?\s*)("|')(\.{1,2}\/[^"'\n]*)\2/g;

const resolveSiblings: TsupPlugin = {
  name: "resolve-siblings",
  renderChunk(code) {
    const extension = this.format === "cjs" ? ".cjs" : ".js";
    const resolved = code.replace(
      RELATIVE_SPECIFIER,
      (match, prefix: string, quote: string, specifier: string) =>
        // A specifier that already names a file keeps it — only the bare
        // module paths our own sources use get an extension appended.
        specifier.slice(specifier.lastIndexOf("/")).includes(".")
          ? match
          : `${prefix}${quote}${specifier}${extension}${quote}`,
    );
    return { code: resolved };
  },
};

export default defineConfig({
  // One entry per source module. `src/*.ts` is not recursive, so `__tests__` is
  // already out.
  entry: ["src/*.ts"],
  format: ["esm", "cjs"],
  bundle: false,
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react"],
  plugins: [resolveSiblings],
});
