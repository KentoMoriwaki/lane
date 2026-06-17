# Contributing

Thanks for your interest in `use-lane`. This document covers local development
of the monorepo: running the demo apps, the testing workflow, and how the
package is built and published.

## Prerequisites

- Node.js **>= 20**
- [pnpm](https://pnpm.io) (the repo pins a version via `packageManager`)

```sh
pnpm install
```

## Repository layout

See the [README](README.md#whats-in-here) for the full table. In short:
`packages/lane` is the library; `apps/*` are the live demo (`apps/demo`, which
embeds its own team API at `/api`), the docs site (`apps/docs`), and the E2E
suite (`apps/e2e`).

## Dev servers

The demo is self-contained — it serves its own team API from `/api`, so one
process is all you need:

```sh
pnpm dev:demo   # http://localhost:3006  — /lane, /lane-spa, /react-query (+ /api)
pnpm dev:docs   # http://localhost:3005
```

With no `TURSO_*` environment variables set, the demo's API uses a local SQLite
file (`apps/demo/data/team-task.sqlite`, git-ignored), created and seeded on first
request. See [DEPLOYMENT.md](DEPLOYMENT.md) for the Turso-backed production setup.

### Demo API environment variables

The embedded team API under `/api` adds small artificial delays so the demo
shows scoped pending, optimistic, and transition states:

- `TEAM_API_READ_DELAY_MS`, `TEAM_API_WRITE_DELAY_MS`, `TEAM_API_PICKER_DELAY_MS`
  — default `100ms` each. Set to `0` to disable. Team data is seeded into
  `apps/demo/data/team-task.sqlite` on first request.
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — when set, the API uses a hosted
  Turso database instead of the local file (see [DEPLOYMENT.md](DEPLOYMENT.md)).

### Simulating failures

For error-handling checks, the embedded API can randomly fail requests:

```sh
API_RANDOM_FAIL_RATE=0.35 pnpm dev:demo
```

`API_RANDOM_FAIL_RATE` is clamped between `0` and `1` and defaults to `0`.
Failures return `{ error: "Random API failure", code: "random_failure" }` with
status `503`. Use `API_RANDOM_FAIL_STATUS=500` to change the status, or
`API_RANDOM_FAIL_PATHS=/api/tasks,/api/insights` to limit failures to path
prefixes. Requests with `x-random-fail-bypass: 1` are never failed;
the demo's server-prefetched `/lane` route adds this header for server
prefetches so the initial server render can succeed while client refreshes still
exercise random failures. `OPTIONS` requests are never failed.

## Testing

```sh
pnpm --filter use-lane test    # library unit and React integration tests
pnpm test:e2e                  # Playwright success-criteria suite
pnpm typecheck                 # all workspaces
```

The E2E suite boots a single `apps/demo` dev server (port 3102) that serves its
own `/api` from a fresh `apps/demo/data/e2e-team-task.sqlite` with no artificial
delays, exercising the `/lane` route, so a locally running dev setup is never
touched. On first run, install the browser:

```sh
pnpm --filter @lane/e2e exec playwright install chromium
```

CI runs unit tests, typechecks, and the E2E suite on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Building & publishing `use-lane`

`pnpm --filter use-lane build` (tsup) emits ESM + CJS bundles with type
definitions to `packages/lane/dist/`, keeping the `"use client"` directive at the
top of each bundle. Inside the workspace the package resolves to `src/` directly;
`publishConfig` switches the entry points to `dist/` when packing.

To cut a release, first update [CHANGELOG.md](CHANGELOG.md) (move the
`[Unreleased]` entries under a new version heading and refresh the compare
links) and commit it. Then run the matching release script from the repo root:

```sh
pnpm release:patch   # 0.1.0 -> 0.1.1
pnpm release:minor   # 0.1.0 -> 0.2.0
pnpm release:major   # 0.1.0 -> 1.0.0
```

These root scripts just forward to `use-lane`; `pnpm --filter use-lane release:patch`
works too. Each `release:*` script runs [`scripts/release.mjs`](packages/lane/scripts/release.mjs),
which refuses a dirty tree, bumps the version, commits it, creates an annotated
`vX.Y.Z` tag (with notes pulled from the matching CHANGELOG section), builds via
`prepublishOnly`, publishes to npm, pushes the commit and tag, and — if the
[`gh` CLI](https://cli.github.com) is available — opens a GitHub release. Because
it pushes straight to the current branch, run it on an up-to-date `main`.

`pnpm --filter use-lane build` then `pnpm --filter use-lane publish` is the
equivalent manual path (`release` on its own publishes the current version and
pushes, without bumping). `pnpm --filter use-lane pack` plus
[publint](https://publint.dev) validate the publish shape without publishing.
