# Supported architectures

Lane targets modern React applications that render from promises and use React
primitives for pending, errors, transitions, and optimistic UI. It is not tied
to one ownership model — it supports two architectures that are both natural in
React Server Component apps:

1. RSC-first ownership
2. RSC-seeded client ownership

Both share the same rule:

```txt
Lane manages promise identity.
React manages UI state.
```

Lane coordinates reads, invalidation-driven re-reads, and authoritative promise
replacement. It does not own mutation state, optimistic state, loading-result
objects, retry policy, or cache-patching policy.

## RSC-first ownership

Use this when route or page data naturally belongs to Server Components.

```txt
URL / route state
-> Server Component loads route and page data
-> Client Components receive rendered data as props
-> Server Function / Server Action mutates server-owned data
-> revalidate / refresh updates the RSC payload
-> Lane owns only client-only async islands
```

Server Components own data such as page-level lists, URL-driven detail data,
dashboard summaries, and route-owned filters. Those change through Server
Functions / Actions and converge through route revalidation, an RSC refresh, or
navigation.

Lane owns data that becomes relevant only through client interaction:

- focused picker search
- label / member suggestions
- command-palette suggestions
- lazily opened client-only panels
- distant consumers that need to observe the same promise invalidation

Lane sits next to Server Components rather than competing with them. If data must
be server-rendered as route or page data, Server Components stay the owner; Lane
coordinates client-only promise identity around them.

## RSC-seeded client ownership

Use this when you want a server-rendered first screen but expect client
components to own live data after hydration. This is the architecture that
competes most directly with a SWR or TanStack Query implementation.

```txt
URL / initial request
-> Server Component loads initial data
-> Client Component receives serializable initial data
-> Lane seeds client promise entries from that initial data
-> after hydration, Lane owns reads and invalidation-driven re-reads
-> client mutations call the API and invalidate or replace Lane promises
```

The Server Component layer resolves the initial user/session context and active
workspace, loads enough for a meaningful first render, canonicalizes invalid URL
state, and passes serializable initial data to the client tree. Seed it with
[`LaneHydration`](./api-reference.md#hydration-rsc-seeding).

After hydration, the client tree owns live data through Lane: filters and search
update durable URL state without forcing an RSC reload, Lane reads the hydrated
promises, and interaction-time changes invalidate and re-read them. Mutations
call the HTTP/API boundary directly.

Client mutations stay React-owned:

| Concern | Owner |
| --- | --- |
| Form / mutation pending | `useActionState`, `useTransition` |
| Optimistic UI | `useOptimistic` |
| Read pending | `Suspense` |
| Read errors | Error Boundaries |
| Convergence | Lane invalidation / replacement of affected promises |

Lane intentionally has no `useMutation`. The mutation call, local failure
recovery, toast, form error, and optimistic reducer are application concerns.

## URL ownership

Both architectures can use durable URL state. The difference is what happens
after the URL changes.

RSC-first ownership:

```txt
URL change -> App Router navigation -> Server Component reloads data -> Client receives new props
```

RSC-seeded client ownership:

```txt
URL change -> client observes the new URL -> Lane key changes or invalidates -> client loader fetches
```

Choose per product surface. A route whose data should be server-rendered uses
RSC-first ownership. A workspace whose first render is server-seeded but whose
live interactions behave like a client data app uses RSC-seeded client ownership.

## Non-goal: legacy SSR hydration

Lane does not currently target pre-RSC SSR hydration patterns — the
`window.__DATA__`-style "server collects arbitrary client-component data, hydrate
into a client cache, CSR takes over" flow. This may be revisited later. Lane
focuses first on React Server Component apps where the server either owns route
data directly or seeds a client-owned promise store in a structured way.

## Examples

The repository's [`apps/demo`](https://github.com/KentoMoriwaki/lane/tree/main/apps/demo)
is a runnable Next.js app that builds the same team-task workspace three ways —
use-lane (RSC-seeded), use-lane (client-only), and a TanStack Query baseline —
switchable by route, so the architectures can be compared directly against one
backend.

## See also

- [API reference](./api-reference.md)
- [Frameworks & routers](./integrations.md) — wiring Lane to Next, React Router, etc.
- [Design notes](./design-notes.md)
