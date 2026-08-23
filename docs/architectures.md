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
| is read by the client, but its truth lives outside (RSC payload, router loader) | **in the lane, published** — [`LaneHydration`](./api-reference.md#lanehydration) | [`loader: external`](./api-reference.md#external--a-read-the-owner-publishes) | the owner republishes; or the client writes confirmed data with `set` / `update`, or marks it stale with `invalidate` and Lane asks the owner via [`refresh`](./api-reference.md#refresh--the-owner-ask) |
| is one the client controls (freshness, contents, when it loads) | **in the lane, client-owned** — never seeded | a normal loader | `invalidate` / `set` / `update` / `remove` |

The middle and bottom rows are the two architectures. The top row is worth
stating because it is the most common wrong answer: data a client component only
*renders* does not belong in a data layer at all. A prop is cheaper than a key.

> **An external read is an ordinary read whose loader the owner holds: the
> value arrives by publication, and a re-read asks the owner to publish again.**
> Everything else about the entry is what it is for a client-owned key. The
> client writes what it has confirmed (`set` / `update` — a mutation's own
> response), and says "this is stale" for what it has not (`invalidate`), which
> Lane turns into an ask on the lane's
> [`refresh`](./api-reference.md#refresh--the-owner-ask). What the client never
> gets is a *freshness policy* on the key: `staleTime` and the `refetchOn*`
> triggers are instructions to a loader, and the loader here is the owner's.

Ownership also decides how a key behaves when a router keeps its tree alive in a
hidden `<Activity>` — a published key converges on the next publication, is
retained by reachability, and asks its owner at the reveal if its value is gone;
a client-owned one converges through notification and the reveal reconciliation. See [under `<Activity>` and router
keep-alive](./consistency.md#activity).

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
-> or: mutation via a Route Handler -> `set` what came back, `invalidate` what derives
-> an invalidated key, when a reader next needs it, asks the owner through `refresh`
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

An infinite list splits the same way and stays on one key: the route publishes
page 1 with
[`infiniteLaneSnapshot`](./api-reference.md#infinitelanesnapshotread-firstpage-initialcursor)
and the browser adds depth with `loadMore` — see
[the first page from the route](./api-reference.md#the-first-page-from-the-route).

What that buys over passing the same data as props: one publication updates every
reader of every affected key at once — the detail, the lists it appears in, the
counts derived from it — because one server render produced them all. The
client-owned variant has to reconstruct that agreement with per-key invalidation
after each mutation.

What it costs is the round trip — for the mutations that take one. A mutation
whose response carries the new value does not: `lane.set(key, updated)` lands it
without a re-render of the route, and only the data that *derives* from it
(counts, insights, a sorted list) needs `invalidate` and the owner's answer. See
[writing to a published key](./api-reference.md#writing-to-a-published-key).
`useOptimistic` over the read value still covers whatever round trip is left,
and is a display concern rather than a write.

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
implementation, and the one where Lane's `staleTime`, `gcTime`, and the
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
| Convergence, server-owned | `set` / `update` what the mutation returned; `invalidate` what derives from it and let Lane ask the owner — or revalidate the source and let the republication land |

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
publishes it into a store whose freshness it keeps deciding.

## Examples

The repository's [`apps/demo`](https://github.com/KentoMoriwaki/lane/tree/main/apps/demo)
is a runnable Next.js app that builds the same team-task workspace seven ways
against one backend. Its landing page groups the routes by the owner whose
freshness policy they follow:

- **App Router-owned:** `/app-router` is the plain-props baseline, where every
  mutation is a Server Action and the whole route comes back. `/lane` reads the
  same sources at the same latency and publishes them for `external` readers —
  one publication per region, each behind its own Suspense boundary, so the
  route streams rather than waiting on its slowest read — and then converges
  both ways: creating something calls an action and reads again, while editing a
  task calls the API from the browser, `set`s what came back, patches the row in
  place, and sets the counters from the response too — the write recomputes them
  server-side, so an inline edit costs one round trip and no rerender at all.
  Optimistic UI covers the round trip.
- **Browser-owned:** `/lane-spa` and `/react-query` ship no workspace data in
  SSR. Browser loaders fetch every key, mutation results patch the entries they
  can determine, and targeted invalidation converges derived data.
- **Integration lab:** `/react-query-rsc` instead dehydrates each App Router
  generation into one browser `QueryClient`, making the extra ownership bridge
  explicit without presenting it as the canonical React Query baseline.
- **Other client stores:** `/relay` and `/jotai` keep the same workspace as
  normalized-store and async-atom reference points.
- **`/lane-router`** — a React Router Data-mode island where the *client* router's
  loaders are the publisher, which is the same server-owned shape with no server
  in it.

## See also

- [API reference](./api-reference.md)
- [Frameworks & routers](./integrations.md) — wiring Lane to Next, React Router, etc.
- [Design notes](./design-notes.md)
