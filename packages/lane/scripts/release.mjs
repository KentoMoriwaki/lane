// Release helper for `use-lane`.
//
// Bumps the version, commits, creates an annotated tag, builds + publishes,
// pushes the commit and tag, and (best-effort) opens a GitHub release. Run via
// `pnpm release:patch | release:minor | release:major`.
//
// Why a script instead of `npm version && pnpm publish`:
//   - `npm version`'s auto commit/tag silently no-ops when invoked through a
//     pnpm script, leaving the bump uncommitted.
//   - `git push --follow-tags` only carries *annotated* tags, so the tag must
//     be annotated to reach the remote.
// Doing the git work explicitly here makes the flow deterministic.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`Usage: release.mjs <patch|minor|major> (got: ${bump ?? "nothing"})`);
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
const gitOut = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// Refuse to release from a dirty tree so the bump lands as a clean, lone commit.
// Update CHANGELOG.md and commit it before releasing.
if (gitOut("status", "--porcelain")) {
  console.error("Working tree is not clean — commit or stash changes first.");
  process.exit(1);
}

// Bump package.json only; the git work below is explicit so it doesn't depend on
// npm/pnpm git config.
execFileSync("npm", ["version", bump, "--no-git-tag-version"], { stdio: "inherit" });

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const tag = `v${version}`;

// Pull this version's notes out of the CHANGELOG (if a section exists) so the
// tag annotation and GitHub release carry real release notes.
let notes = "";
try {
  const root = gitOut("rev-parse", "--show-toplevel");
  const md = readFileSync(`${root}/CHANGELOG.md`, "utf8");
  const esc = version.replace(/[.]/g, "\\$&");
  const match = md.match(
    new RegExp(`## \\[${esc}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[)`),
  );
  notes = match ? match[1].trim() : "";
} catch {
  // No readable CHANGELOG — fall through with empty notes.
}
if (!notes) {
  console.warn(`No CHANGELOG section found for ${version}; tagging with a minimal message.`);
}
const tagMessage = notes ? `use-lane ${version}\n\n${notes}` : `use-lane ${version}`;

git("commit", "-am", `use-lane ${version}`);
git("tag", "-a", tag, "-m", tagMessage);

// Build runs via prepublishOnly; publish, then push the commit + annotated tag.
execFileSync("pnpm", ["publish"], { stdio: "inherit" });
git("push", "--follow-tags");

// Best-effort GitHub release reusing the tag's notes. Skipped if gh is absent.
try {
  execFileSync("gh", ["release", "create", tag, "--title", tag, "--notes-from-tag"], {
    stdio: "inherit",
  });
} catch {
  console.log(
    `Skipped GitHub release — create it manually:  gh release create ${tag} --notes-from-tag`,
  );
}

console.log(`\n✅ Released use-lane ${version}`);
