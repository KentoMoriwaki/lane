# lane

`lane` is a monorepo for exploring a React Transition-friendly client data library.

The library package is intentionally empty for now. The current workspace exists to provide comparable TODO applications against the same SQLite backend:

- `apps/todo-api`: shared TODO backend backed by SQLite.
- `apps/todo-nextjs-swr`: Next.js TODO app using SWR.
- `apps/todo-nextjs-lane`: Next.js TODO app reserved for the `lane` comparison path.
- `packages/lane`: placeholder package for the future library implementation.

The TODO apps use Hono RPC by importing `AppType` from `@lane/todo-api` as a
type-only dev dependency.

## Development

```sh
pnpm install
pnpm dev:api
pnpm dev:todo-nextjs-swr
pnpm dev:todo-nextjs-lane
```

By default, the API listens on `http://localhost:4000`. The Next.js apps read `NEXT_PUBLIC_TODO_API_URL`, falling back to that URL.

The TODO API delays `/todos` requests by `1000ms` by default so the demo apps show pending and transition states. Set `TODO_API_DELAY_MS=0` to disable the delay.
