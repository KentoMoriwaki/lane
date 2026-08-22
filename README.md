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
| [`apps/demo`](apps/demo) | The live demo — one team-task workspace, seven implementations grouped by ownership. Primary pairs: `/app-router` versus `/lane` for App Router ownership — the same reads, one re-rendering the route for every mutation and the other converging through the lane and asking for a rerender only for what it cannot compute — and `/react-query` versus `/lane-spa` for browser ownership. `/react-query-rsc` isolates the server-generation-to-QueryClient bridge as an integration lab; `/relay` and `/jotai` are client-store references. It embeds its own team API (Hono + libSQL/Turso) at `/api`. |
| [`apps/docs`](apps/docs) | The Nextra documentation site (sourced from `docs/*.md`). |
| [`apps/e2e`](apps/e2e) | Playwright suite for the primary App Router and SPA comparisons, including navigation, mutation convergence, stale refresh, and deterministic request-budget assertions. |

The demo's team API (Hono + libSQL/Turso) is embedded as a Next.js Route Handler
at [`apps/demo/src/app/api/[[...route]]/route.ts`](apps/demo/src/app/api), and the
frontend talks to it through the typed Hono RPC client at the same origin
(`/api`). It uses a local SQLite file in development and Turso in production —
see **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Getting started

```sh
pnpm install
pnpm dev:demo   # http://localhost:3006 — open / to choose a comparison (+ /api)
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full dev-server matrix,
environment variables, the testing workflow, and how `use-lane` is built and
published.
