# Frameworks & routers

How to wire Lane to the thing that owns your URL. For the ownership models behind
this, see [supported architectures](./architectures.md); for *why* Lane is
transition-native, see [design notes](./design-notes.md).

The throughline: **Lane owns promise identity; React owns UI state; the
framework/router owns the URL and navigation.** Lane is deliberately
router-agnostic — it never imports a router and never reads `window.location`.
Every integration below is the same small contract, wired by a few lines of *your*
code.

## The integration contract

Whatever the host, an integration comes down to five decisions:

| Concern | How |
| --- | --- |
| **Identity** | Derive each Lane key from durable route/URL state — `key = f(URL)`. Revisiting a route re-reads the same key. |
| **Ownership** | Per key: publish it from the host's data layer with [`LaneHydration`](./api-reference.md#lanehydration) and read it with [`external`](./api-reference.md#external--a-read-the-owner-publishes), or let the client own it and fetch on first read. Not both — two loaders for one key is the one pairing that has no answer. |
| **Navigation** | Commit route changes inside a React transition so a suspending read keeps the current screen instead of flashing a Suspense fallback. |
| **Convergence** | Client-owned: `invalidate` (re-read) or publish confirmed data with `set` / `update`. Published: the same `set` / `update` for data the mutation returned, `invalidate` for what derives from it — Lane then asks the host through [`refresh`](./api-reference.md#refresh--the-owner-ask) — or mutate the source and let the host revalidate, in which case the republication is the convergence. |
| **Retention** | For client-owned keys, a Lane policy — `gcTime`, on the lane or on the read — not the router. For published keys, [reachability](./api-reference.md#external-retention): the host's payload and committed readers decide, and `gcTime` does not apply. |
| **The ask** | Give the lane a [`refresh`](./api-reference.md#refresh--the-owner-ask) that means "render again" to the host — `() => router.refresh()`, `() => revalidator.revalidate()`. Without it, a published key that was invalidated or collected waits out its timeout. |

The glue that connects the router's data to Lane (e.g. a `withHydration` HOC) lives
in *your app*: neither Lane nor the router ships it, because neither knows about
the other. That is the point — the same core integrates with any host.

## Transitions, and the back/forward caveat

A route change that triggers a suspending read must be a **synchronous
transition**, or React replaces the page with the nearest Suspense fallback. This
is the pattern React itself recommends for routers: update router state inside
`startTransition`, then let the destination suspend in render.

Lane is built for this. It keeps each key's promise in `useState` + `useTransition`
— **not** in a `useSyncExternalStore` read during render — so a Lane read never
forces a synchronous fallback during a transition the way an external-store read
can. What that costs, stated exactly, is in
[Cross-reader consistency](./consistency.md).

The one place this breaks is **browser back/forward (`popstate`)**. The legacy
`popstate` event must run synchronously (for scroll and form restoration), so a
transition started from it is forced to finish synchronously — and if the
destination *suspends*, the fallback flashes. This is a constraint of the History
API, shared by essentially every client router, not a Lane or React-Router quirk.
(The Navigation API, whose `navigate` handler can be async, is the forward-looking
fix.)

The practical consequence: **make back/forward land on data that is already
cached, so nothing suspends.** That is a retention decision, covered next.

## Keep-alive (`<Activity>`), and what it does not promise

Next's router keeps recent inactive route trees alive in hidden `<Activity>`
subtrees, so returning to one restores its state and DOM instead of rebuilding
them. Lane is built for that — [what a revealed reader
shows](./consistency.md#activity) is specified frame by frame. Three limits are
worth knowing before you design around it, because none of them is Lane's to fix:

- **A re-suspension on traverse is the framework's layer.** An intercepted or
  parallel-route modal restored by browser back/forward is rebuilt from the
  router's payload (interception varies by referrer, so the segment cannot be
  reused as-is), which re-suspends the boundary under it. Lane's entry is
  untouched — the loader does not run and the value is already there — so what you
  see is the router's own fallback, not a Lane re-read. Pushing to the same modal
  reuses the cache node and does not do this.
- **A reveal that outruns its publication falls back.** If the payload for a
  revisited route has not landed when the tree is revealed, the boundary shows its
  fallback until it does. That is the same presentation Next itself chooses (a
  revisit shows the shell immediately and the in-flight holes as fallbacks) rather
  than something Lane adds — but it does mean keep-alive is not a promise that a
  return is *complete*, only that it is instant.
- **Activity is an instant-restore tool.** If a screen must arrive complete rather
  than instantly, do not keep it alive: unmount it and navigate in a transition, so
  React holds the current screen while the destination resolves and commits once.
  Keep-alive and "no intermediate states" are different goals, and the router
  cannot serve both for the same surface.

## Cache lifetime across navigation

To make back/forward feel instant (and flash-free), the route's entry must still be
warm when you return to it. Three knobs, all on Lane — and all of them for
**client-owned** keys, since a published key's lifetime belongs to whoever
publishes it ([retention](./api-reference.md#external-retention)):

- **`key = f(URL)`** — the entry's identity is the route, so returning re-reads the
  same entry instead of a fresh one.
- **`gcTime`** (on [`createLane`](./api-reference.md#createlaneoptions) for the
  lane, or on the read for one route) — how long an inactive route's entry is
  retained after you navigate away; this is your back/forward window, and the
  only thing that decides whether a revisit suspends. Generous keeps the return
  instant; `Infinity` pins everything for the session (like a framework router
  cache; costs memory). `0` makes every revisit a fresh load, which is a flash on
  back/forward — do that only for a route whose data must not be shown twice.
  Staleness alone never takes a value away: refreshing what a returning reader is
  showing is `staleTime` + `refetchOnMount`'s job, and it happens underneath the
  value rather than instead of it.

This is the same shape a Next.js App Router cache has — `URL → key → in-memory
cache → data` — except you choose the policy explicitly instead of inheriting a
framework default. For reachability-scoped retention (evict an entry only once its
route leaves the history stack), drive `lane.remove(key)` from the Navigation API's
`navigation.entries()` in an app-level adapter; the core stays time-based.

## Prefetching on intent

The retention knobs above make *back*-navigation instant. For *forward*
navigation, warm the destination's data on intent: call
[`lane.prefetch(read)`](./api-reference.md#prefetch) from a link's
`onMouseEnter` / `onFocus`, so its keys are in flight (or settled) before the
route mounts and the reader adopts the warm cache instead of fetching. Repeat
hovers dedupe, and a warm-up nothing adopts is reclaimed within `warmTime`. Use
the same read the destination's `useLane` will use, so the keys line up.

## Next.js App Router

*Demonstrated by the demo's `/lane` (server-owned) and `/lane-spa` (client-owned)
routes.*

Next **is** the data router: Server Components load route data and publish it into
Lane, and the client reads it without fetching. This is Lane's
[server-owned reads](./architectures.md#server-owned-reads--published-read-with-external)
model — and the decision is per key, so client-owned reads live beside it on the
same route.

```tsx
// Server Component: load route data, publish it under the keys your hooks read.
const snapshots = { entries: [laneSnapshot(taskLanes.list(filters), tasks)] };

<LaneProvider>
  <LaneHydration snapshots={snapshots}>
    <Workspace /> {/* client: useLane(taskLanes.list(filters)) — declared
                     `loader: external`, so it reads the publication */}
  </LaneHydration>
</LaneProvider>;
```

```tsx
// The ask, wired once in a client component that holds the provider.
"use client";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <LaneProvider refresh={() => router.refresh()}>{children}</LaneProvider>
  );
}
```

```ts
// The read both halves import. `external` says: the route fills this.
export const taskLanes = {
  list: (filters: TaskFilters) =>
    laneRead<Task[]>({ key: ["tasks", filters], loader: external }),
};
```

- **Navigation** is wrapped in transitions by Next, so a `<Link>` to a route that
  republishes does not flash. A filter or selection in the URL *is* a navigation,
  so the same mechanism serves it.
- **Back/forward** is handled *for you*: Next's client Router Cache restores the
  segment from cache (mirroring bfcache) rather than refetching, so there is no
  suspend and no flash. Lane only needs matching keys; a republication on
  navigation overwrites and mounted readers converge.
- **Mutations** come in two shapes, and the axis is *"do I want the screen read
  again?"* — see [the two mutation channels](#the-two-mutation-channels).
  A **Server Action that revalidates** (`revalidatePath` / `updateTag`) answers
  with the re-rendered payload, which republishes every seeded key at once;
  nothing is left for Lane to do. A **Route Handler** answers with the new value
  and nothing else: `lane.set` / `lane.update` land what it returned in place,
  `lane.invalidate` marks what derives from it, and the next reader of an
  invalidated key gets `refresh` fired for it — one `router.refresh()` for
  however many keys one run invalidated. Cover whatever round trip is left with
  `useOptimistic` over the read value.
- **Client-only** surfaces (no publication) just call `useLane` with their own
  loader and fetch on first read — that is `/lane-spa`, and a single route can
  mix the two as long as no key is in both.
- **An infinite list is one key too.** The route publishes page 1 with
  [`infiniteLaneSnapshot`](./api-reference.md#infinitelanesnapshotread-firstpage-initialcursor)
  and `useInfiniteLane`'s `loadMore` fetches the rest from the browser; a
  republication of the same page 1 keeps the depth the user scrolled to — see
  [the first page from the route](./api-reference.md#the-first-page-from-the-route).
- **"the same keys" can be the same module.** `use-lane` marks only its React
  modules `"use client"`, so
  [`laneKey`](./api-reference.md#lanekeyoft--a-key-that-knows-what-it-holds),
  [`laneRead`](./api-reference.md#lanereadspec--key--loader-colocation), and the
  snapshot builders are callable in the Server Component above. The key factory
  your hooks import serves the seed too — no server-safe copy of the literals,
  and the same `"use-lane"` import path in both graphs. `/lane` does exactly
  this.

You do not add React Router here — Next already owns navigation, route data, and the
back/forward cache.

### The two mutation channels

Both are supported and they mix on one route. The choice is behavioural, not
stylistic:

| | Server Action + revalidate | Route Handler + Lane writes |
| --- | --- | --- |
| Round trips | One — the action's response carries the re-rendered route | One for the mutation; a second only if something was invalidated and a reader needs it |
| Concurrency | Serialized in the client's action queue (a navigation discards a pending action's router result) | Parallel — better for a control users click repeatedly |
| Scope | Always re-renders the current route, even when revalidating a different path | Touches exactly the keys you name |
| "Make another screen stale without touching this one" | Not expressible | `lane.invalidate(key)` — nothing happens until that screen is revealed |

One constraint ties them together: a Route Handler cannot bump the client
router's cache, and a `"use cache"` segment is served from the prefetch for its
`cacheLife` `stale` window. So **do not put data you mutate through a Route
Handler behind `"use cache"`** — a navigation would render the pre-mutation
segment and republish over your write. Data that must be both cached and mutated
goes through a Server Action with `updateTag`.

One more, about order: a mutation that `invalidate`s a key and then **navigates
in the same breath** — a delete that moves the view back to the list — has its
`router.refresh()` aborted by that navigation ("Navigations take priority over
any pending actions"). The readers waiting on the key are suspended and never
read again on their own, so Lane keeps asking every `REASK_INTERVAL` (2 s) for as
long as a subscribed reader is still waiting, and the screen converges on the
next answer. It costs one render the aborted ask already paid for. Navigating
first and marking after avoids it where the order is yours to choose.

## React Router v7 / v8

*Demonstrated by the demo's `/lane-router` route (Data mode, hash-routed island).*

Two modes, two ways to integrate. **Vite is not required** — Data mode and
Declarative mode are plain library imports; only Framework mode needs the React
Router Vite plugin. (v8 is ESM-only; import `RouterProvider` from `react-router/dom`
and everything else from `react-router`.)

### Declarative mode — components own fetching

`<BrowserRouter>` + `<Routes>`, no loaders. Each route component fetches its own
data with `useLane` and suspends in render. `<Link>` (PUSH) navigations are
flash-free transitions by default.

```tsx
function UsersRoute() {
  const { promise } = useLane({
    key: ["users"],
    loader: ({ signal }) => fetchUsers(signal),
    staleTime: 5_000,
    refetchOnMount: true, // returning refreshes underneath the value it shows
  });
  return <UserList users={use(promise).data} />;
}
```

Caveat: a back/forward that lands on a *suspending* read can flash (the `popstate`
constraint above). Mitigate with an adequate `gcTime` so the entry is warm on
return and the read does not suspend at all. Declarative mode also does not surface a navigation
pending state — wrap `navigate` in your own `useTransition` if you want a progress
indicator.

### Data mode — loaders publish into Lane

`createBrowserRouter` + loaders. **This is the server-owned shape with no server
in it**: `LaneHydration` is not RSC-specific, it applies a payload of snapshots to
a lane, and a client router's loader data is exactly such a payload. The loader is
the owner; Lane is the distribution layer that gets the data to components the
router's `useLoaderData` cannot reach, and the channel for asking the loader to
run again.

```tsx
export async function usersLoader({ request }) {
  const data = await fetchUsers(request.signal);
  return { entries: [{ key: ["users"], data }] }; // a LaneHydrationSnapshots
}

// The read the UI uses: published by the loader, never fetched by the client.
const usersRead = laneRead<UsersData>({ key: ["users"], loader: external });

// app-level glue — not provided by either library
function withHydration(Ui) {
  return function HydratedRoute() {
    return (
      <LaneHydration snapshots={useLoaderData()}>
        <Ui /> {/* useLane(usersRead) finds the published promise */}
      </LaneHydration>
    );
  };
}

createBrowserRouter([
  { path: "users", loader: usersLoader, Component: withHydration(UsersList) },
]);
```

- **Load-then-render** sidesteps the `popstate` flash entirely: the loader resolves
  *before* the route renders, so nothing suspends during navigation — including on
  back/forward — and `useNavigation()` surfaces a pending state for every
  navigation, popstate included.
- **The loader is what keeps hydration idempotent.** `useLoaderData()` hands back
  the same snapshots object across re-renders of a match and a new one when the
  loader re-runs, which is exactly what
  [`LaneHydration`](./api-reference.md#lanehydration) keys on. Don't move the
  `{ entries: … }` assembly into the component — built during render it is a new
  object every time, and the boundary never commits.
- React Router **re-runs loaders on back/forward** by default (unlike Next, which
  restores from cache). To make back instant, return `false` from `shouldRevalidate`
  for POP, or have the loader read through Lane's cache.
- **Wire the ask to the revalidator.**
  `<LaneProvider refresh={useRevalidator().revalidate}>` — then
  `lane.invalidate(key)` on a published key re-runs the loaders when a reader
  next needs it, which produces a new snapshots object and republishes.
- **Refreshing and mutating go through the router, unless the mutation returns
  the value.** `useRevalidator()` re-runs the loaders; a mutation changes the
  source and then revalidates. That route is the one to take when you want the
  loader's whole answer, and what you get for it is an edit that survives
  navigating away and back, because it was never a local edit. When the mutation
  hands you the new value, `lane.set` / `lane.update` land it in place without a
  loader run — and the next loader run states at least as much, so the two do not
  disagree. The demo's `/lane-router` is exactly this shape.

## TanStack Router

*General guidance — not exercised by a demo in this repo.*

TanStack Router is Suspense- and transition-oriented and has loaders, so the
**Data-mode recipe applies unchanged**: load in the route loader, return a
`LaneHydration` snapshot, read with `useLane`. Its typed search params are a natural
fit for `key = f(search)`. As with any History-API router, the `popstate` caveat
holds; prefer Lane's own pending (`isInvalidationPending` / `isBackgroundPending`) and
the router's loader-pending over relying on a single navigation flag.

## Plain SPA, or embedding inside another router

**No framework router.** Wrap your own `navigate` in `startTransition` (or use a
tiny router) and derive keys from `location`. Lane's transition model does the rest.

**Embedding an SPA inside a host that owns the pathname** (e.g. a single Next.js
route) — use a **hash router** so the two routers never fight over the URL:

```tsx
// The host (Next) owns the pathname (/lane-router); React Router owns "#/…".
// createHashRouter touches window, so create it only after mount (client-only).
const [router] = useState(() => createHashRouter(routes));
<LaneProvider><RouterProvider router={router} /></LaneProvider>;
```

The demo's `/lane-router` is exactly this: a Data-mode, hash-routed React Router SPA
mounted as a client island inside a Next route. Next sees only `/lane-router`; React
Router drives `#/users`, `#/posts`, … — disjoint URL parts, zero conflict, and the
full Data-mode behavior (loader → hydration → `useLane`, no-flash back/forward,
`useNavigation` pending) carries over.

## See also

- [Supported architectures](./architectures.md) — the per-key ownership rule: RSC props, published (`external`), or client-owned.
- [Design notes](./design-notes.md) — why Lane is transition-native by construction.
- [API reference](./api-reference.md) — `LaneHydration`, `useLane`, `gcTime`.
