# lane

`lane` is a monorepo for exploring a React Transition-friendly client data library.

The library package is intentionally empty for now. The current workspace exists to provide comparable TODO applications against the same SQLite backend:

- `apps/todo-api`: shared backend backed by SQLite. It serves the original
  TODO endpoints and a richer team task API under `/api` (users, teams, tasks,
  projects, labels, members, insights) used by the team workspace apps.
- `apps/todo-nextjs-swr`: Next.js TODO app using SWR.
- `apps/todo-nextjs-lane`: Next.js TODO app reserved for the `lane` comparison path.
- `apps/todo-nextjs-react-query`: "Calm Command Workspace" — a team task
  management app built as the TanStack Query baseline (Next.js App Router server
  prefetch + dehydration, then a client query cache that owns reads, writes,
  optimistic updates, and retries). This is the UX/behaviour baseline Lane
  should be able to replace.
- `packages/lane`: placeholder package for the future library implementation.

The apps use Hono RPC by importing `AppType` from `@lane/todo-api` as a
type-only dependency.

## Development

```sh
pnpm install
pnpm dev:api
pnpm dev:todo-nextjs-swr             # http://localhost:3001
pnpm dev:todo-nextjs-lane            # http://localhost:3002
pnpm dev:todo-nextjs-react-query     # http://localhost:3003
```

By default, the API listens on `http://localhost:4000`. The Next.js apps read `NEXT_PUBLIC_TODO_API_URL`, falling back to that URL.

The TODO API delays `/todos` requests by `1000ms` by default so the demo apps show pending and transition states. Set `TODO_API_DELAY_MS=0` to disable the delay.

The team task API under `/api` adds smaller, separate delays so the React Query
baseline shows scoped pending, optimistic, and transition states. Tune them with
`TEAM_API_READ_DELAY_MS`, `TEAM_API_WRITE_DELAY_MS`, and
`TEAM_API_PICKER_DELAY_MS` (set to `0` to disable). The team task data is seeded
into `data/team-task.sqlite` on first run.
