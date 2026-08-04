# Migrating from React Query / SWR

React Query and SWR own a **resolved-value cache** plus their own status objects
(`isLoading` / `isError` / `status`), optimistic patches, and mutation helpers.
Lane owns only the **promise identity** behind each key and hands the rest back to
React: loading is a `Suspense` fallback, errors go to an Error Boundary, "pending"
is a transition, and optimistic UI is `useOptimistic`. Migrating is mostly
*deleting* the parallel machinery, not rewriting fetches.

For the reasoning behind the split see [design notes](./design-notes.md); for the
anti-patterns to avoid, [common mistakes](./common-mistakes.md).

## The mental-model map

| React Query / SWR | Lane |
| --- | --- |
| `queryKey` | the read **key** (`["user", id]`) — a structural array |
| `queryFn` / fetcher | the **loader** — forward `({ signal })` to `fetch` |
| `Register["queryMeta"]` / `meta` | `LaneRegister["loaderMeta"]` → `loader({ meta })`, supplied at the provider ([step 0](#step-0--keep-your-options-factories)) |
| `queryOptions({ … })` | `laneRead({ key, loader, …options })` ([step 0](#step-0--keep-your-options-factories)) |
| `infiniteQueryOptions({ … })` | `infiniteLaneRead({ key, initialCursor, fetchPage, nextCursor })` |
| `DataTag` on `queryKey` | `LaneKeyOf<T>` — `spec.key`, or `laneKey<T>(…)` |
| `useQuery().data` | `use(promise).data`, read under a `Suspense` boundary |
| `useInfiniteQuery` | `useInfiniteLane` — one key holds the accumulated list ([step 6](#step-6--infinite-lists)) |
| `isLoading` (no data yet) | a **`Suspense` fallback** — there is no flag |
| `isError` / `error` (initial) | an **Error Boundary** — an initial load rejects |
| `error` *over existing data* | `refreshError` from `use(promise)` — render it inline |
| `isFetching` / `isRefetching` | `isTransitionPending` (explicit) / `isBackgroundPending` (auto) |
| `keepPreviousData` / `placeholderData` | **transitions** — wrap the key change, or `useDeferredValue` |
| `invalidateQueries(key)` | `invalidate(key)` exact, `invalidate(prefix)`, or a predicate |
| `setQueryData(key, v)` | `set(key, v)` — for confirmed data you already have |
| `onMutate` optimistic patch | `useOptimistic` — local to the action, no cache write |
| `refetchInterval` | a **userland poll** — a self-scheduled `invalidate` |
| `refetchOnWindowFocus` | `refetchOnFocus` (`LaneProvider` wires focus / reconnect) — pair it with a `staleTime`, or it never fires |
| `refetchOnMount: "always"` | no equivalent — `refetchOnMount: true, staleTime: 0`, or `invalidate(key, { onlyIf: "settled" })` |
| `staleTime` / `gcTime` | `staleTime` (read option, defaults to `Infinity` — react-query defaults to `0`) / `gcTime` (`createLane`) |
| `QueryClientProvider` | `LaneProvider` |

## Step 0 — keep your options factories

If the codebase is organised around `queryOptions()` factories, that organisation
survives the migration intact: `laneRead` is the same idea — one value carrying a
read's key, its loader, and the options it is read with — and Lane accepts it
everywhere a key or a `(key, loader)` pair is accepted.

```ts
// Before (React Query)
export const taskQueries = {
  detail: (id: string) =>
    queryOptions({
      queryKey: ["task", id],
      queryFn: ({ signal }) => fetchTask(id, signal),
      staleTime: 60_000,
    }),
};

// After (Lane)
export const taskLanes = {
  detail: (id: string) =>
    laneRead({
      key: ["task", id],
      loader: ({ signal }) => fetchTask(id, signal),
      staleTime: 60_000,
    }),
};
```

The call sites map one for one:

| React Query | Lane |
| --- | --- |
| `useQuery(taskQueries.detail(id))` | `useLane(taskLanes.detail(id))` |
| `useSuspenseQuery(taskQueries.detail(id))` | `useLane(taskLanes.detail(id))` — every read suspends |
| `queryClient.prefetchQuery(taskQueries.detail(id))` | `lane.prefetch(taskLanes.detail(id))` |
| `queryClient.invalidateQueries(taskQueries.detail(id))` | `lane.invalidate(taskLanes.detail(id).key)` |
| `queryClient.setQueryData(taskQueries.detail(id).queryKey, task)` | `lane.set(taskLanes.detail(id).key, task)` |
| `queryClient.getQueryData(taskQueries.detail(id).queryKey)` | **no equivalent** — see [there is no cache getter](#there-is-no-cache-getter) |
| `useQueries({ queries: ids.map(taskQueries.detail) })` | `useLanesAll(ids.map(taskLanes.detail))` |

The shape of that table is the same as react-query's, and for the same reason.
`queryOptions` tags its `queryKey` with the data type (`DataTag`), which is what
makes `getQueryData` / `setQueryData` typed from the key alone; Lane's
[`LaneKeyOf`](./api-reference.md#lanekeyoft--a-key-that-knows-what-it-holds) is
that idea, so anything addressing an entry takes `spec.key` and the loader stays
out of it.

Three differences worth knowing:

- **`invalidateQueries` takes filters; `invalidate` takes one key.** For a family,
  use a prefix or predicate scope: `lane.invalidateAll(["tasks"])`.
- **A write-only module needs no options factory.** Where react-query gets its tag
  only from `queryOptions` (which requires a `queryFn`), Lane also has
  `laneKey<T>(["task", id])` — a typed key with no loader, so a mutation module
  imports keys and nothing else.
- **`meta` moves from the query to the lane.** If your `queryFn`s read
  `({ meta })` for a session or an API client, declare it once and supply it at
  the provider instead of on each read:

  ```ts
  // Before                                    // After
  declare module "@tanstack/react-query" {     declare module "use-lane" {
    interface Register { queryMeta: Ctx }        interface LaneRegister { loaderMeta: Ctx }
  }                                            }

  queryOptions({ queryKey, queryFn, meta })    <LaneProvider loaderMeta={ctx}>
  ```

  The loader still receives it as `meta`, and a single read can still override it
  (`{ ...taskLanes.detail(id), loaderMeta: other }`). The difference is that the
  lane's value is mandatory, so `meta` is non-optional inside the loader rather
  than always possibly-`undefined`. See
  [`LaneRegister`](./api-reference.md#laneregister--what-loaders-are-handed-besides-the-key).

Colocating is what keeps a key from drifting away from the loader and options it
belongs to — and with `meta` on the lane, a read's arguments are exactly what
decides its key, so `.key` stays reachable from a mutation module or a Server
Component. See
[`laneRead`](./api-reference.md#lanereadspec--key--loader-colocation).

## Step 1 — read with `use()`, delete the status object

The core move: stop returning `{ data, isLoading, error }` and start returning a
promise you unwrap with `use()`. Loading and errors move out of the component and
into the boundaries — once, around the subtree.

```tsx
// Before (React Query)
const { data, isLoading, error } = useQuery(["user", id], () => fetchUser(id));
if (isLoading) return <Spinner />;
if (error) return <ErrorView />;
return <Profile user={data} />;

// After (Lane)
const { promise } = useLane({
  key: ["user", id],
  loader: ({ signal }) => fetchUser(id, signal),
});
const { data } = use(promise);
return <Profile user={data} />;
```

```tsx
<ErrorBoundary fallback={<ErrorView />}>
  <Suspense fallback={<Spinner />}>
    <Profile id={id} />
  </Suspense>
</ErrorBoundary>
```

## A transitional adapter is fine — but don't rebuild the state machine

To keep call-site churn small in a large codebase, it is reasonable to wrap
`useLane` + `use()` in a `useQuery`-shaped hook. If you do, keep the split honest:

- **No `isLoading`.** Initial loading is Suspense; a hook field for it has no
  correct value, because the component has already suspended.
- **`error` is only `refreshError`.** An *initial* failure rejects to the Error
  Boundary and never reaches a field. Expose `refreshError` — a failed refresh
  *over* existing data — not a general `error`.
- **`isPending` / `isFetching` mean "refreshing over data,"** not "no data yet."
  Map them to `isBackgroundPending` / `isTransitionPending`.
- **Pass the key straight to `useLane`.** Lane canonicalizes keys internally — no
  `useMemo` / `JSON.stringify` wrapper needed. (If the key *also* feeds an effect
  dependency array — e.g. a poll — see [step 5](#step-5--revalidation-and-polling).)

## Step 2 — loading, errors, and the resilient panel

Once reads suspend, a data widget composes into a few layers:

- **Initial load** → a `Suspense` boundary (per widget or per section).
- **Refreshing over data** → an `isBackgroundPending` / `isTransitionPending`
  affordance (an overlay or a subtle bar), *not* a fallback.
- **A failed refresh** → render the stale `data` **and** the `refreshError` as a
  small inline hint. Don't throw it; don't blank the panel.
- **Empty** → your empty state, once loaded.

```tsx
<Suspense fallback={<PanelSkeleton />}>
  <Panel /> {/* reads with use(); shows refreshError inline + a background spinner */}
</Suspense>
```

Give **ephemeral surfaces their own boundary.** A modal, popover, combobox, or tab
panel that fires an initial read will *unmount itself* if it suspends to a
page-level boundary — see [Suspense boundaries decide what stays
mounted](./common-mistakes.md#suspense-boundaries-decide-what-stays-mounted).

## Step 3 — search and filters stay live

`keepPreviousData` becomes a transition. For a URL- or state-derived filter, derive
**both the key and the loader** from a `useDeferredValue` so the current list stays
on screen while the next one loads:

```tsx
const deferred = useDeferredValue(filters);
const isStale = deferred !== filters; // drive a pending affordance off this
const { promise } = useLane({
  key: ["rows", deferred],
  loader: ({ signal }) => fetchRows(deferred, signal),
});
```

See [key changes that flash](./common-mistakes.md#key-changes-that-flash-filters-navigation-props).

## Step 4 — mutations converge by invalidation

Drop `useMutation`. Call the API from an action, then re-point the source.

*(This step is about **client-owned** keys — the ones your loaders fetch, which is
what a React Query migration starts with. If a key is instead published into Lane
by an RSC route or a router loader, its mutations go back through that owner and
these calls throw; see [the ownership
rule](./architectures.md#the-ownership-rule).)*

```tsx
await patchUser(id, body);
lane.invalidate(["user", id]); // re-read the exact key, in a transition
lane.invalidate(["users"]);    // and any list read, by prefix
// or publish the confirmed entity you already have:
lane.set(["user", id], updated);
```

Optimistic UI stays **local to the action** with `useOptimistic` — never write a
guess into Lane, or every consumer would see it.

**Porting an existing invalidation protocol.** If your app already invalidates by
its own string keys (e.g. a `modified("website:123")` convention), write a resolver
that maps each string to a Lane [scope](./api-reference.md#keys) — an exact key, a
prefix, or a predicate — and **unit-test it**. It is the load-bearing seam of the
migration; a wrong scope silently fails to converge.

## There is no cache getter

`getQueryData`, `getQueriesData`, and `getQueryState` have no Lane equivalent,
and the absence is a decision rather than a gap. Every method on the `Lane`
instance returns a promise or `void`, so a value reaches a component through
`use(promise)` and nowhere else — see [the store returns promises, never
data](./design-notes.md#the-store-returns-promises-never-data) for why. Where
each use of it goes:

| What you reached for it for | In Lane |
| --- | --- |
| `onMutate` — snapshot the previous value for rollback | Nothing to port. Optimistic state is `useOptimistic` over the read value, so there is no shared write to roll back. |
| `setQueryData(key, old => …)` — derive from the current value | [`lane.update(key, current => …)`](./api-reference.md#update--updateall) — the updater is handed the value, and chains onto an in-flight read rather than racing it. |
| `initialData` / `placeholderData` from another key | Usually nothing: wrap the navigation in a transition and the previous screen stays live until the next read resolves. To show a partial value *immediately*, `lane.set(key, value)` with the value you already have — it becomes that key's authoritative value, carrying no staleness from where it came from. |
| Reading in an event handler without subscribing | Pass the value in from the component that rendered it. |
| A socket / push message | `lane.set` or `lane.update` when the message carries the value; `lane.invalidate` when it only announces a change. No "do I hold this key" guard is needed — invalidation is render-driven, so an entry nobody reads costs nothing until it is read. |
| Asserting cache contents in a test | Assert what a reader renders. |

SWR's `cache.get(key)` and its `useSWRConfig().cache` map the same way; so does
reading `api.endpoints.x.select(arg)(getState())` out of RTK Query in a thunk.

## Step 5 — revalidation and polling

Focus / reconnect / mount revalidation are read options (`refetchOnFocus`,
`refetchOnMount`, `refetchOnReconnect`); `LaneProvider` wires the focus and
reconnect listeners. **Polling is userland** — there is no `refetchInterval`. Use a
self-scheduled `invalidate(key, { onlyIf: "settled", background: true })`, and keep
its schedule **off the render path**: don't put the key *array* in an effect's
dependency list (it is a fresh reference every render, so the timer never settles).
See [polling](./api-reference.md#polling).

## Step 6 — infinite lists

`useInfiniteQuery` becomes [`useInfiniteLane`](./api-reference.md#useinfinitelaneread--a-cursor-paginated-list).
The shapes line up almost one for one, and the two caches hold the same thing —
one entry per list, holding every page:

| React Query | Lane |
| --- | --- |
| `InfiniteData<{ pages, pageParams }>` | `use(promise).data` → `{ pages, params, hasNext }` |
| `getNextPageParam(lastPage, pages)` | `nextCursor(page, cursor)` — `null` ends the list |
| `initialPageParam` | `initialCursor` |
| `fetchNextPage()` | `loadMore()` |
| `isFetchingNextPage` | `isTransitionPending` — it also covers a full re-read |
| `hasNextPage` | `data.hasNext` — **in the value**, not on the hook |

```tsx
// Before (React Query)
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ["feed", filters],
  queryFn: ({ pageParam, signal }) => fetchFeed({ cursor: pageParam, filters, signal }),
  initialPageParam: null as string | null,
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});
const items = data?.pages.flatMap((page) => page.items) ?? [];

// After (Lane)
const { promise, loadMore } = useInfiniteLane({
  key: ["feed", filters],
  initialCursor: null as string | null,
  fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
  nextCursor: (page) => page.nextCursor,
});
const { data } = use(promise);
const items = data.pages.flatMap((page) => page.items);
```

Three things to carry across:

- **The refetch cost is identical, and it is not a Lane tax.** Invalidating a
  five-page list is five sequential requests in both libraries, because each
  cursor is re-derived from the page before it. React Query's
  `infiniteQueryBehavior` walks that loop internally; Lane's loader walks it in
  front of you. What differs is what the user sees: the transition keeps the list
  on screen throughout, and a failure part-way through leaves the previous list
  rendered with `refreshError` beside it rather than flipping the read into an
  error state.
- **`hasNextPage` moves into the data.** The hook returns a promise it does not
  resolve, so it cannot report a flag derived from the pages. Read `data.hasNext`
  from the same `use(promise)` that gives you the rows — actions from the hook,
  data from the promise.
- **Don't keep the page count in component state.** The depth is read back out of
  the cached value, which is the whole point; mirroring it in a ref reintroduces a
  desync Lane just removed. See [common
  mistakes](./common-mistakes.md#holding-an-infinite-lists-depth-in-component-state).

## Migration checklist

- [ ] `queryOptions()` factories ported to `laneRead` — key, loader, and options
      still in one place; reads take the definition, `invalidate` / `set` take
      its `key`.
- [ ] Replaced `useQuery` reads with `useLane` + `use(promise)`; deleted the
      `isLoading` / `error` / `status` branches.
- [ ] `Suspense` and Error Boundaries placed at the right granularity — including
      **inside** every modal / popover / combobox / tab panel that reads.
- [ ] Search / filter keys derive from `useDeferredValue` (both the key and the
      loader).
- [ ] Mutations converge via `invalidate` / `set`; optimistic UI moved to
      `useOptimistic`; no cache patching.
- [ ] Any legacy string-key invalidation mapped to Lane scopes and **tested**.
- [ ] `useInfiniteQuery` lists ported to `useInfiniteLane`, reading `hasNext`
      from the resolved value and keeping no page count in component state.
- [ ] Loaders forward `({ signal })` explicitly — not through a shared module global.
- [ ] Polling is a userland `invalidate`, its schedule independent of render frequency.

## See also

- [Common mistakes](./common-mistakes.md) — the anti-patterns above, in detail.
- [API reference](./api-reference.md) — exact signatures and options.
- [Design notes](./design-notes.md) — why Lane makes this split.
