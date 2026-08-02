# Supported architectures

Lane targets modern React applications that render from promises and use React
primitives for pending, errors, transitions, and optimistic UI. It is not tied
to one ownership model — it supports two, and the choice is made **per key**:

1. server-owned reads (the truth lives outside the browser; Lane distributes it)
2. client-owned reads (the client fetches the key and decides its freshness)

Both share the same rule:

```txt
Lane manages promise identity.
React manages UI state.
```

Lane coordinates reads, invalidation-driven re-reads, and authoritative promise
replacement. It does not own mutation state, optimistic state, loading-result
objects, retry policy, or cache-patching policy.

## The ownership rule

Ask it of one key at a time. Most routes answer differently for different keys,
and that is the expected shape — not a compromise.

| The key… | Put it | Reads with | Changes through |
| --- | --- | --- | --- |
| is not read reactively by any client component | **not in the lane** — pass it as RSC props | — | a new render |
| is read by the client, but its truth lives outside (RSC payload, router loader) | **in the lane, published** — [`LaneHydration`](./api-reference.md#lanehydration) | [`loader: external`](./api-reference.md#external--a-read-the-owner-publishes) | mutate the source → revalidate → republish |
| is one the client controls (freshness, contents, when it loads) | **in the lane, client-owned** — never seeded | a normal loader | `invalidate` / `set` / `update` / `remove` |

The middle and bottom rows are the two architectures. The top row is worth
stating because it is the most common wrong answer: data a client component only
*renders* does not belong in a data layer at all. A prop is cheaper than a key.

> **The one configuration Lane rejects: seeding a key the client then mutates.**
> A key that arrives from a publication *and* is written to locally has two
> sources of truth and no way to reconcile them — the next payload silently
> overwrites the local write, or it never comes and the local write outlives the
> truth. Since 0.8, a seeded key is external, and `lane.set` / `update` /
> `invalidate` / `remove` on one **throw**
> ([`LaneOwnershipError`](./api-reference.md#laneownershiperror)) in development
> and production alike. Pick a row; the runtime holds you to it.

## RSC-first ownership — the key stays out of the lane

Use this when route or page data naturally belongs to Server Components and no
client component needs to *react* to it.

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

## Server-owned reads — published, read with `external`

Use this when the truth lives outside the browser but client components have to
read it *reactively*: several distant consumers, a value that must converge when
the route republishes, a promise that has to reach a component props cannot.

```txt
URL / initial request
-> Server Component loads route data
-> LaneHydration publishes it into the lane
-> client reads it with `loader: external` — no fetch, it waits for the publication
-> mutation: Server Action -> revalidate -> the payload re-streams -> republish
```

The Server Component layer resolves the session and active workspace, loads
enough for a meaningful first render, canonicalizes invalid URL state, and
publishes with [`LaneHydration`](./api-reference.md#lanehydration). The client
declares that it is *not* the owner by reading with
[`external`](./api-reference.md#external--a-read-the-owner-publishes):

```ts
export const taskLanes = {
  list: (filters: TaskFilters) =>
    laneRead<Task[]>({ key: ["tasks", filters], loader: external }),
};
```

What that buys over passing the same data as props: one publication updates every
reader of every affected key at once — the detail, the lists it appears in, the
counts derived from it — because one server render produced them all. The
client-owned variant has to reconstruct that agreement with per-key invalidation
after each mutation.

What it costs is the round trip. Cover it with `useOptimistic` over the read
value, which is a display concern and never a write; see
[mutating a server-owned key](./api-reference.md#mutating-a-server-owned-key).

## Client-owned reads

Use this when the client controls the data: freshness policy, when it loads, and
what it holds after a mutation. No seeding — a client-owned key is never
published into.

```txt
URL / interaction
-> useLane({ key, loader }) fetches on first read
-> filters and search change the key; the client re-reads
-> mutation: call the API, then invalidate / set / update the affected keys
```

This is the architecture that competes most directly with a SWR or TanStack Query
implementation, and the one where Lane's `staleTime`, `whenStale`, and the
`refetchOn*` triggers apply — they are instructions to a loader, so a
server-owned read has none of them.

Both layers can share one read module. `use-lane` puts `"use client"` on its React
modules individually rather than on the package, so
[`laneKey`](./api-reference.md#lanekeyoft--a-key-that-knows-what-it-holds),
[`laneRead`](./api-reference.md#lanereadspec--key--loader-colocation), and
[`laneSnapshot`](./api-reference.md#lanesnapshotreadorkey-data) are callable in
the Server Component that builds the snapshots, from the same `"use-lane"` import
the client hooks use. Reads therefore live in one place for both halves of the
route, instead of a server-safe list of literals plus a typed copy of it on the
client:

```ts
// page.tsx — a Server Component. No loader runs; a read is a plain object.
const snapshots = { entries: [laneSnapshot(taskLanes.list(filters), tasks)] };
```

What makes that work in both directions is that a read's arguments are only what
decides its key — the session its loaders need arrives from the lane as
[`loaderMeta`](./api-reference.md#laneregister--what-loaders-are-handed-besides-the-key),
which the server seed never has to produce.

Mutations stay React-owned in both architectures. Only the convergence row
differs:

| Concern | Owner |
| --- | --- |
| Form / mutation pending | `useActionState`, `useTransition` |
| Optimistic UI | `useOptimistic` (over the read value, in both) |
| Read pending | `Suspense` |
| Read errors | Error Boundaries |
| Convergence, client-owned | Lane invalidation / replacement of affected promises |
| Convergence, server-owned | mutate the source, revalidate, and let the republication land |

Lane intentionally has no `useMutation`. The mutation call, local failure
recovery, toast, form error, and optimistic reducer are application concerns.

## URL ownership

Both architectures can use durable URL state. The difference is what happens
after the URL changes.

RSC-first ownership:

```txt
URL change -> App Router navigation -> Server Component reloads data -> Client receives new props
```

Server-owned reads:

```txt
URL change -> navigation -> the route re-renders -> new payload -> republish -> readers converge
```

A filter or a selection in the URL is a navigation, so the publication that
follows it is the same mechanism that serves a mutation. A key the payload has
not published yet (a filter combination nobody has requested before) suspends on
its `external` wait until that navigation's payload lands — no client fetch fills
it in.

Client-owned reads:

```txt
URL change -> client observes the new URL -> Lane key changes or invalidates -> client loader fetches
```

Choose per product surface, and per key inside it. A route whose data should be
server-rendered and never locally edited uses server-owned reads; a workspace
whose live interactions behave like a client data app owns its keys and is never
seeded with them.

## Non-goal: legacy SSR hydration

Lane does not currently target pre-RSC SSR hydration patterns — the
`window.__DATA__`-style "server collects arbitrary client-component data, hydrate
into a client cache, CSR takes over" flow. This may be revisited later. Lane
focuses first on apps where the server either owns route data directly or
publishes it into a store the client reads but does not write.

## Examples

The repository's [`apps/demo`](https://github.com/KentoMoriwaki/lane/tree/main/apps/demo)
is a runnable Next.js app that builds the same team-task workspace several ways
against one backend, switchable by route. The two that answer this page's
question differently are worth reading side by side:

- **`/lane` — server-owned.** Every workspace key is published by the RSC route
  and read with `external`; mutations are Server Actions that `revalidatePath`,
  and `useOptimistic` covers the round trip.
- **`/lane-spa` — client-owned.** No seeding; the client fetches every key and
  keeps its own cache honest after a mutation.
- **`/react-query`, `/relay`, `/jotai`** — the same workspace in other libraries.
- **`/lane-router`** — a React Router Data-mode island where the *client* router's
  loaders are the publisher, which is the same server-owned shape with no server
  in it.

## See also

- [API reference](./api-reference.md)
- [Frameworks & routers](./integrations.md) — wiring Lane to Next, React Router, etc.
- [Design notes](./design-notes.md)
