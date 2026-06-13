// Syncs the canonical docs/*.md into the Nextra content/ directory as .mdx,
// rewriting relative `./name.md` links to extensionless site routes.
// docs/*.md stays the source of truth (it is what the npm README links to);
// the generated .mdx files are git-ignored and rebuilt on predev/prebuild.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../../../docs");
const contentDir = resolve(here, "../content");

const pages = ["api-reference", "architectures", "design-notes"];

mkdirSync(contentDir, { recursive: true });

for (const name of pages) {
  const source = readFileSync(resolve(docsDir, `${name}.md`), "utf8");
  const rewritten = source.replace(
    /\]\(\.\/([\w-]+)\.md(#[\w-]+)?\)/g,
    (_match, page, hash) => `](/${page}${hash ?? ""})`,
  );
  const banner = `{/* Generated from docs/${name}.md. Edit that file, then run \`pnpm --filter @lane/docs sync\`. */}\n\n`;
  writeFileSync(resolve(contentDir, `${name}.mdx`), banner + rewritten);
}

console.log(`Synced ${pages.length} docs into apps/docs/content`);
