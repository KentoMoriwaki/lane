// Projects the canonical docs/*.md into each consumer.
//
// docs/*.md is the single source of truth. Every projection below is generated
// and git-ignored — never hand-edit a projection. Edit docs/*.md, then run
// `pnpm docs:sync` (all targets) or a per-consumer script.
//
// Usage:
//   node scripts/project-docs.mjs            # all targets
//   node scripts/project-docs.mjs nextra     # one target
//   node scripts/project-docs.mjs skill
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const docsDir = resolve(repoRoot, "docs");

// The canonical pages, in reading order. The single source of truth for the set
// of docs that fan out to every consumer.
const PAGES = [
  "api-reference",
  "architectures",
  "integrations",
  "design-notes",
  "common-mistakes",
];

const TARGETS = {
  // Nextra docs site: .mdx, relative `./name.md` links rewritten to site routes,
  // JSX-comment banner (valid MDX).
  nextra: {
    dir: resolve(repoRoot, "apps/docs/content"),
    ext: "mdx",
    render: (name, source) =>
      `{/* Generated from docs/${name}.md. Edit that file, then run \`pnpm docs:sync\`. */}\n\n` +
      source.replace(
        /\]\(\.\/([\w-]+)\.md(#[\w-]+)?\)/g,
        (_match, page, hash) => `](/${page}${hash ?? ""})`,
      ),
  },

  // Agent skill references: .md, content kept verbatim. The pages are emitted as
  // siblings, so their relative `./name.md` cross-links resolve as-is. The
  // HTML-comment banner renders to nothing when read as Markdown.
  skill: {
    dir: resolve(repoRoot, "packages/lane/skills/use-lane/references"),
    ext: "md",
    render: (name, source) =>
      `<!-- Generated from docs/${name}.md. Edit that file, then run \`pnpm docs:sync\`. -->\n\n` +
      source,
  },
};

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(TARGETS);

for (const name of names) {
  const target = TARGETS[name];
  if (!target) {
    console.error(
      `Unknown target "${name}". Known targets: ${Object.keys(TARGETS).join(", ")}.`,
    );
    process.exit(1);
  }

  mkdirSync(target.dir, { recursive: true });
  for (const page of PAGES) {
    const source = readFileSync(resolve(docsDir, `${page}.md`), "utf8");
    writeFileSync(
      resolve(target.dir, `${page}.${target.ext}`),
      target.render(page, source),
    );
  }
  console.log(
    `Projected ${PAGES.length} docs → ${name} (${relative(repoRoot, target.dir)})`,
  );
}
