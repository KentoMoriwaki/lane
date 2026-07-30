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
| **Seeding** | Either seed from the host's data layer with [`LaneHydration`](./api-reference.md#hydration-rsc-seeding), or let a client component fetch on first read via [`useLane`](./api-reference.md#uselaneread). |
| **Navigation** | Commit route changes inside a React transition so a suspending read keeps the current screen instead of flashing a Suspense fallback. |
| **Convergence** | After a mutation, converge with `invalidate` (re-read), or publish authoritative data with `set` / `update`. |
| **Retention** | How long a route's entry survives back/forward is a Lane policy — `gcTime` + `whenStale` — not the router. |

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

## Cache lifetime across navigation

To make back/forward feel instant (and flash-free), the route's entry must still be
warm when you return to it. Three knobs, all on Lane:

- **`key = f(URL)`** — the entry's identity is the route, so returning re-reads the
  same entry instead of a fresh one.
- **`gcTime`** (instance-wide, on [`createLane`](./api-reference.md#createlaneoptions))
  — how long an inactive route's entry is retained after you navigate away; this is
  your back/forward window. `Infinity` pins everything for the session (like a
  framework router cache; costs memory).
- **`whenStale`** — `"revalidate"` (default) keeps showing the cached value and
  refreshes in the background, so a stale revisit does **not** suspend (no flash).
  `"refetch"` discards the stale value and suspends — which can flash on
  back/forward. Prefer `"revalidate"` for route-backing reads.

This is the same shape a Next.js App Router cache has — `URL → key → in-memory
cache → data` — except you choose the policy explicitly instead of inheriting a
framework default. For reachability-scoped retention (evict an entry only once its
route leaves the history stack), drive `lane.remove(key)` from the Navigation API's
`navigation.entries()` in an app-level adapter; the core stays time-based.

## Prefetching on intent

The retention knobs above make *back*-navigation instant. For *forward*
navigation, warm the destination's data on intent: call
[`lane.prefetch(key, loader)`](./api-reference.md#prefetch) from a link's
`onMouseEnter` / `onFocus`, so its keys are in flight (or settled) before the
route mounts and the reader adopts the warm cache instead of fetching. Repeat
hovers dedupe, and a warm-up nothing adopts is reclaimed by GC. Use the same key
the destination's `useLane` will use, so they line up.

## Next.js App Router

*Demonstrated by the demo's `/lane` (RSC-seeded) and `/lane-spa` (client-only)
routes.*

Next **is** the data router: Server Components load route data, you seed Lane from
it, and the client owns reads after hydration. This is Lane's
[RSC-seeded client ownership](./architectures.md#rsc-seeded-client-ownership) model.

```tsx
// Server Component: load route data, seed Lane with the same keys your hooks use.
const snapshots = { entries: [{ key: ["tasks", filters], data: tasks }] };

<LaneProvider>
  <LaneHydration snapshots={snapshots}>
    <Workspace /> {/* client: useLane({
      key: ["tasks", filters],
      loader: …,
    }) reads the seed */}
  </LaneHydration>
</LaneProvider>;
```

- **Navigation** is wrapped in transitions by Next, so a `<Link>` to a route that
  re-hydrates does not flash.
- **Back/forward** is handled *for you*: Next's client Router Cache restores the
  segment from cache (mirroring bfcache) rather than refetching, so there is no
  suspend and no flash. Lane only needs matching keys; re-hydration on navigation
  overwrites and mounted readers converge.
- **Client-only** surfaces (no server seed) just call `useLane` and fetch on first
  read — that is `/lane-spa`.
- **"the same keys" can be the same module.** `use-lane` marks only its React
  modules `"use client"`, so
  [`laneKey`](./api-reference.md#lanekeyoft--a-key-that-knows-what-it-holds) and
  [`laneRead`](./api-reference.md#lanereadspec--key--loader-colocation) are
  callable in the Server Component above. The key factory your hooks import serves
  the seed too — no server-safe copy of the literals, and the same `"use-lane"`
  import path in both graphs. `/lane` does exactly this.

You do not add React Router here — Next already owns navigation, route data, and the
back/forward cache.

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
    whenStale: "revalidate", // so back/forward to a stale route does not suspend
  });
  return <UserList users={use(promise).data} />;
}
```

Caveat: a back/forward that lands on a *suspending* read can flash (the `popstate`
constraint above). Mitigate with `whenStale: "revalidate"` + an adequate `gcTime`
so the entry is warm on return. Declarative mode also does not surface a navigation
pending state — wrap `navigate` in your own `useTransition` if you want a progress
indicator.

### Data mode — loaders seed Lane

`createBrowserRouter` + loaders. The loader is the "server" seam: it fetches and
returns a `LaneHydration` snapshot; a small wrapper seeds Lane before the UI reads.

```tsx
export async function usersLoader({ request }) {
  const data = await fetchUsers(request.signal);
  return { entries: [{ key: ["users"], data }] }; // a LaneHydrationSnapshots
}

// app-level glue — not provided by either library
function withHydration(Ui) {
  return function HydratedRoute() {
    return (
      <LaneHydration snapshots={useLoaderData()}>
        <Ui /> {/* useLane({
          key: ["users"],
          loader: …,
        }) finds the hydrated promise */}
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
- React Router has **no direct loader-data write** (no `setQueryData` equivalent) —
  only revalidation. After hydration, Lane's `set` / `update` / `invalidate`
  (key-granular) fill that gap.

## TanStack Router

*General guidance — not exercised by a demo in this repo.*

TanStack Router is Suspense- and transition-oriented and has loaders, so the
**Data-mode recipe applies unchanged**: load in the route loader, return a
`LaneHydration` snapshot, read with `useLane`. Its typed search params are a natural
fit for `key = f(search)`. As with any History-API router, the `popstate` caveat
holds; prefer Lane's own pending (`isTransitionPending` / `isBackgroundPending`) and
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

- [Supported architectures](./architectures.md) — RSC-first and RSC-seeded ownership.
- [Design notes](./design-notes.md) — why Lane is transition-native by construction.
- [API reference](./api-reference.md) — `LaneHydration`, `useLane`, `gcTime`, `whenStale`.
