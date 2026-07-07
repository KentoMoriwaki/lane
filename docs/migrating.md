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
| `useQuery().data` | `use(promise).data`, read under a `Suspense` boundary |
| `isLoading` (no data yet) | a **`Suspense` fallback** — there is no flag |
| `isError` / `error` (initial) | an **Error Boundary** — an initial load rejects |
| `error` *over existing data* | `refreshError` from `use(promise)` — render it inline |
| `isFetching` / `isRefetching` | `isTransitionPending` (explicit) / `isBackgroundPending` (auto) |
| `keepPreviousData` / `placeholderData` | **transitions** — wrap the key change, or `useDeferredValue` |
| `invalidateQueries(key)` | `invalidate(key)` exact, `invalidate(prefix)`, or a predicate |
| `setQueryData(key, v)` | `set(key, v)` — for confirmed data you already have |
| `onMutate` optimistic patch | `useOptimistic` — local to the action, no cache write |
| `refetchInterval` | a **userland poll** — a self-scheduled `invalidate` |
| `refetchOnWindowFocus` | `refetchOnFocus` (`LaneProvider` wires focus / reconnect) |
| `staleTime` / `gcTime` | `staleTime` (read option) / `gcTime` (`createLane`) |
| `QueryClientProvider` | `LaneProvider` |

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
const { promise } = useLane(["user", id], ({ signal }) => fetchUser(id, signal));
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
const { promise } = useLane(["rows", deferred], ({ signal }) => fetchRows(deferred, signal));
```

See [key changes that flash](./common-mistakes.md#key-changes-that-flash-filters-navigation-props).

## Step 4 — mutations converge by invalidation

Drop `useMutation`. Call the API from an action, then re-point the source:

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

## Step 5 — revalidation and polling

Focus / reconnect / mount revalidation are read options (`refetchOnFocus`,
`refetchOnMount`, `refetchOnReconnect`); `LaneProvider` wires the focus and
reconnect listeners. **Polling is userland** — there is no `refetchInterval`. Use a
self-scheduled `invalidate(key, { onlyIf: "settled", background: true })`, and keep
its schedule **off the render path**: don't put the key *array* in an effect's
dependency list (it is a fresh reference every render, so the timer never settles).
See [polling](./api-reference.md#polling).

## Migration checklist

- [ ] Replaced `useQuery` reads with `useLane` + `use(promise)`; deleted the
      `isLoading` / `error` / `status` branches.
- [ ] `Suspense` and Error Boundaries placed at the right granularity — including
      **inside** every modal / popover / combobox / tab panel that reads.
- [ ] Search / filter keys derive from `useDeferredValue` (both the key and the
      loader).
- [ ] Mutations converge via `invalidate` / `set`; optimistic UI moved to
      `useOptimistic`; no cache patching.
- [ ] Any legacy string-key invalidation mapped to Lane scopes and **tested**.
- [ ] Loaders forward `({ signal })` explicitly — not through a shared module global.
- [ ] Polling is a userland `invalidate`, its schedule independent of render frequency.

## See also

- [Common mistakes](./common-mistakes.md) — the anti-patterns above, in detail.
- [API reference](./api-reference.md) — exact signatures and options.
- [Design notes](./design-notes.md) — why Lane makes this split.
