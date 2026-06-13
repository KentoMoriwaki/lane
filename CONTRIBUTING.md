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
`packages/lane` is the library; `apps/*` are the live demo (`apps/demo`), the
docs site (`apps/docs`), the shared backend (`apps/todo-api`), and the E2E suite
(`apps/e2e`).

## Dev servers

Start the backend first, then any app:

```sh
pnpm dev:api
pnpm dev:demo   # http://localhost:3006  — /lane, /lane-spa, /react-query
pnpm dev:docs   # http://localhost:3005
```

By default the API listens on `http://localhost:4000`. The Next.js apps read
`NEXT_PUBLIC_TODO_API_URL`, falling back to that URL.

### API environment variables

- `TODO_API_DELAY_MS` — the TODO API delays `/todos` requests by `1000ms` by
  default so the demo apps show pending and transition states. Set to `0` to
  disable.
- `TEAM_API_READ_DELAY_MS`, `TEAM_API_WRITE_DELAY_MS`, `TEAM_API_PICKER_DELAY_MS`
  — the team task API under `/api` adds smaller, separate delays so the React
  Query baseline shows scoped pending, optimistic, and transition states. Set to
  `0` to disable. Team task data is seeded into `data/team-task.sqlite` on first
  run.

### Simulating failures

For read/error-handling checks, the API can randomly fail requests:

```sh
API_RANDOM_FAIL_RATE=0.35 pnpm dev:api
```

`API_RANDOM_FAIL_RATE` is clamped between `0` and `1` and defaults to `0`.
Failures return `{ error: "Random API failure", code: "random_failure" }` with
status `503`. Use `API_RANDOM_FAIL_STATUS=500` to change the status, or
`API_RANDOM_FAIL_PATHS=/api/tasks,/api/insights` to limit failures to path
prefixes. Requests with `x-random-fail-bypass: 1` are never failed;
the demo's server-prefetched `/lane` route adds this header for server
prefetches so the initial server render can succeed while client refreshes still
exercise random failures.
`/health` and `OPTIONS` requests are never failed.

## Testing

```sh
pnpm --filter use-lane test    # library unit and React integration tests
pnpm test:e2e                  # Playwright success-criteria suite
pnpm typecheck                 # all workspaces
```

The E2E suite boots its own API instance (port 4100, fresh
`data/e2e-team-task.sqlite`, no artificial delays) and a dedicated `apps/demo`
dev server (port 3102) exercising the `/lane` route, so a locally running dev
setup is never touched. On first run, install the browser:

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

To cut a release:

```sh
pnpm --filter use-lane build
pnpm --filter use-lane publish
```

`pnpm --filter use-lane pack` plus [publint](https://publint.dev) validate the
publish shape without publishing.
