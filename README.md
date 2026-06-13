# lane

Monorepo for **[`use-lane`](packages/lane)** — transition-native data fetching
for React 19. Refetches run inside React transitions, so the current UI stays
live while the next data loads. Lane caches the promises behind your keys; React
owns loading (Suspense), errors (Error Boundaries), and optimistic UI
(`useOptimistic`).

- 📦 **Package** — [`use-lane`](packages/lane) · [npm](https://www.npmjs.com/package/use-lane)
- 📖 **Docs** — [API reference](docs/api-reference.md) · [Architectures](docs/architectures.md) · [Design notes](docs/design-notes.md)
- 🛠 **Local setup & contributing** — [CONTRIBUTING.md](CONTRIBUTING.md)

## What's in here

The workspace pairs the `packages/lane` implementation with comparable TODO
applications against the same SQLite backend, so Lane can be evaluated by
replacing SWR / TanStack Query while preserving — or improving — the same user
experience with React transitions.

| Path | Description |
| --- | --- |
| [`packages/lane`](packages/lane) | The `use-lane` library and its unit/React-integration tests. |
| [`apps/todo-api`](apps/todo-api) | Shared SQLite backend. Serves the original TODO endpoints and a richer team task API under `/api` (users, teams, tasks, projects, labels, members, insights). |
| [`apps/todo-nextjs-swr`](apps/todo-nextjs-swr) | Next.js TODO app using SWR. |
| [`apps/todo-nextjs-lane`](apps/todo-nextjs-lane) | Next.js team workspace on the Lane comparison path. The E2E suite runs against it. |
| [`apps/todo-nextjs-lane-spa`](apps/todo-nextjs-lane-spa) | Client-only Lane workspace variant: same backend and UI shape as `todo-nextjs-lane`, but all workspace reads are owned by Lane on the client instead of App Router server prefetch. |
| [`apps/todo-nextjs-react-query`](apps/todo-nextjs-react-query) | "Calm Command Workspace" — the TanStack Query baseline (App Router server prefetch + dehydration, then a client query cache). This is the UX/behaviour baseline Lane should be able to replace. |
| [`apps/e2e`](apps/e2e) | Playwright suite running the user-facing success criteria (reload restoration, search, mutation convergence, team switching, stale-on-error refresh) against `todo-nextjs-lane`. |

The apps consume the backend through Hono RPC, importing `AppType` from
`@lane/todo-api` as a type-only dependency.

## Getting started

```sh
pnpm install
pnpm dev:api
pnpm dev:todo-nextjs-lane   # http://localhost:3002
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full dev-server matrix,
environment variables, the testing workflow, and how `use-lane` is built and
published.
