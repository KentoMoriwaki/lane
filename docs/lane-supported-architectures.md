# Lane Supported Architectures

Lane is intended to support modern React applications that render from
promises and use React primitives for pending, errors, transitions, and
optimistic UI.

Lane should not be limited to one ownership model. It should support two
architectures that are both natural in React Server Component applications:

1. RSC-first ownership
2. RSC-seeded client ownership

Both architectures share the same rule:

```txt
Lane manages promise identity.
React manages UI state.
```

Lane should coordinate reads, refreshes, and shared promise replacement. It
should not own mutation state, optimistic state, loading result objects, retry
policy, or cache patching policy unless a future design explicitly adds those
responsibilities.

## Architecture 1: RSC-First Ownership

Use this architecture when route or page data naturally belongs to Server
Components.

```txt
URL / route state
-> Server Component loads route and page data
-> Client Components receive rendered data as props
-> Server Function or Server Action mutates server-owned data
-> revalidate / refresh updates the RSC payload
-> Lane owns only client-only async islands
```

In this architecture, Server Components own data such as:

- page-level task lists
- selected detail data when it is part of the URL
- dashboard summaries
- route-owned filters and search results
- server-rendered navigation data

Server-owned data should be changed through Server Functions, Server Actions,
or equivalent server mutations. The resulting UI should converge through route
revalidation, an RSC refresh, or navigation.

Lane owns data that becomes relevant only through client interaction:

- focused picker search
- label and member suggestions
- command palette suggestions
- lazily opened client-only panels
- distant client consumers that need to observe the same refresh promise
- local async data that is not the owner of the route or page

This keeps Lane next to Server Components rather than competing with them. If
data must be server-rendered as route or page data, Server Components remain
the owner. Lane coordinates client-only promise identity around that server
owner.

## Architecture 2: RSC-Seeded Client Ownership

Use this architecture when a product wants a server-rendered first screen but
expects client components to own live data after hydration.

```txt
URL / initial request
-> Server Component loads initial data
-> Client Component receives serializable initial data
-> Lane seeds client promise entries from that initial data
-> after hydration, Lane owns reads and refreshes
-> client mutations call the API and replace or refresh Lane promises
```

This is the architecture that competes most directly with a React Query or SWR
implementation.

The Server Component layer is responsible for:

- resolving the initial user/session context
- resolving the active workspace or team
- loading the data needed for a meaningful first render
- canonicalizing invalid URL state before the client takes over
- passing serializable initial data to the client tree

After hydration, the client tree owns live data through Lane:

- filters and search can update durable URL state without forcing an RSC reload
- Lane reads hydrated promises for the first render
- Lane refreshes promises after interaction-time changes
- client mutations call the HTTP/API boundary directly
- React primitives own pending, errors, and optimistic UI

In this mode, Lane needs a way to seed client-owned promises from server-loaded
initial data, then refresh or replace those promises after client interactions.
The exact API shape belongs in a focused design document, not in this
architecture overview.

Client mutations in this architecture should still be React-owned:

- form and mutation pending: `useActionState`, `useTransition`
- optimistic UI: `useOptimistic`
- read pending: `Suspense`
- read errors: Error Boundaries
- convergence: Lane-managed refresh or replacement of affected promises

Lane should not add a `useMutation` API just because this architecture supports
client-side writes. The mutation call, rollback decision, toast, form error,
and optimistic reducer are application concerns.

## URL Ownership

Both supported architectures can use durable URL state. The difference is what
happens after the URL changes.

In RSC-first ownership:

```txt
URL change
-> App Router navigation
-> Server Component reloads route/page data
-> Client Components receive new props
```

In RSC-seeded client ownership:

```txt
URL change
-> client state observes the new URL
-> Lane key changes or refreshes
-> client-side loader fetches new data
```

Choose the model per product surface. A route whose data should be
server-rendered should use RSC-first ownership. A workspace whose first render
should be server-seeded but whose live interactions should behave like a client
data app should use RSC-seeded client ownership.

## Explicit Non-Goal: Legacy SSR Hydration

Lane does not currently target pre-RSC SSR hydration patterns.

Unsupported for now:

```txt
server renders Client Components
-> server collects arbitrary data for those Client Components
-> data is attached to window.__DATA__ or an equivalent global
-> hydration copies that data into a client cache
-> CSR takes over
```

This pattern can be revisited later, but it is not part of the initial design.
Lane should first focus on React Server Component applications where the server
can either own the route data directly or seed a client-owned promise store in a
structured way.

## Product Evaluation Guidance

The team task app should exercise both supported architectures over time.

The React Query baseline represents a server-initialized client cache app. The
Lane replacement can use the RSC-seeded client ownership architecture to compare
against that baseline directly.

Separate examples should continue to validate the RSC-first ownership
architecture: route/page data stays in Server Components, and Lane is used for
client-only async islands such as label search and picker refresh.
