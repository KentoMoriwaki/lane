# lane

Monorepo for **[`use-lane`](packages/lane)** — **promise-first,
transition-native** data fetching for React 19. Lane keeps each keyed read's
promise in React state, so Suspense reads it, transitions replace it, and the
current UI stays live while the next data loads. Lane owns promise identity;
React owns loading, errors, pending, and optimistic UI.

- 📦 **Package** — [`use-lane`](packages/lane) · [npm](https://www.npmjs.com/package/use-lane)
- 📖 **Docs** — [API reference](docs/api-reference.md) · [Migrating from RQ / SWR](docs/migrating.md) · [Common mistakes](docs/common-mistakes.md) · [Architectures](docs/architectures.md) · [Frameworks & routers](docs/integrations.md) · [Design notes](docs/design-notes.md) · [Cross-reader consistency](docs/consistency.md)
- 🤖 **Agent skill** — version-locked guidance for AI coding agents · [how to use it](packages/lane/README.md#agent-skill)
- 🛠 **Local setup & contributing** — [CONTRIBUTING.md](CONTRIBUTING.md)

## What's in here

The workspace pairs the `packages/lane` implementation with a live demo that
builds the same team-task workspace several ways against one embedded team API,
so Lane can be evaluated against the TanStack Query baseline while preserving —
or improving — the same user experience with React transitions.

| Path | Description |
| --- | --- |
| [`packages/lane`](packages/lane) | The `use-lane` library and its unit/React-integration tests. |
| [`apps/demo`](apps/demo) | The live demo — one team-task workspace, five implementations switchable by route: `/lane` (use-lane, RSC-seeded), `/lane-spa` (use-lane, client-only), `/react-query` (the TanStack Query baseline), `/relay` (a normalized GraphQL store), and `/jotai` (async atoms, no fetching library). It embeds its own team API (Hono + libSQL/Turso) at `/api`. |
| [`apps/docs`](apps/docs) | The Nextra documentation site (sourced from `docs/*.md`). |
| [`apps/e2e`](apps/e2e) | Playwright suite running the user-facing success criteria (reload restoration, search, mutation convergence, team switching, stale-on-error refresh) against the demo's `/lane` route. |

The demo's team API (Hono + libSQL/Turso) is embedded as a Next.js Route Handler
at [`apps/demo/src/app/api/[[...route]]/route.ts`](apps/demo/src/app/api), and the
frontend talks to it through the typed Hono RPC client at the same origin
(`/api`). It uses a local SQLite file in development and Turso in production —
see **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Getting started

```sh
pnpm install
pnpm dev:demo   # http://localhost:3006  — /lane, /lane-spa, /react-query, /relay, /jotai (+ /api)
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full dev-server matrix,
environment variables, the testing workflow, and how `use-lane` is built and
published.
