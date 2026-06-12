# Lane API Design Notes

This document records API design direction for Lane.

It is not a requirements document. Requirements describe needed capabilities;
this note describes preferred API shape and priority.

## Primary Convergence API: Source Invalidation

Lane should make source invalidation the primary way to converge after a
mutation.

Preferred mental model:

```txt
mutate source
-> invalidate affected read
-> render from the next promise
```

This intentionally mirrors the Server Component model:

```txt
mutate source
-> revalidate / refresh
-> render from the next data
```

The reason to prefer this as the primary API is conceptual consistency. A Lane
application should usually think in terms of "this source changed; read it
again" rather than "patch this external cache."

Invalidation should be render-driven. Lane does not need to eagerly refetch away
from render the way a query cache can. When an entry is invalidated, mounted
readers can re-render in a transition; their `useLane(key, loader)` call can
create the next promise from the current loader. Inactive entries can stay
invalidated and fetch the next promise when they are read again.

See `docs/lane-use-lane-reference.md` for the reference starting point for the
hook that connects invalidation events to React state.

## Hydration Overwrites

Lane hydration applies server snapshots as authoritative values.

`hydrateMany` (and the `LaneHydration` boundary built on it) overwrites existing
entries and notifies invalidate subscribers. Navigation is the reason: when a
route transition re-hydrates the same keys with fresh server data, mounted
readers must converge to the new data. A set-only-if-absent seed would keep
rendering the previous page's data after navigation. (An earlier revision of
this note described seed as "set only if absent"; that was a design mistake.)

Idempotency lives at the boundary, not in the store operation. `LaneHydration`
applies a given snapshots instance to a given lane at most once, so repeated
provider renders and Strict Mode re-renders do not re-publish the same
snapshot. A new snapshots instance produced by a new server render is
intentionally authoritative and replaces client entries for those exact keys.

Hydration should not be used as cache patching after mutations. Once the client
owns the read, convergence should use invalidation or confirmed value
publication.

## Confirmed Value Publication Is Secondary

Lane should still have a way to publish already available authoritative data
for an exact key, but this should be secondary to invalidation.

This operation is not for optimistic UI. Optimistic state belongs in
component-local React state, such as `useOptimistic`. Since optimistic state is
not written into Lane, Lane does not need a rollback or revert API.

Confirmed value publication is useful when the application already has
server-confirmed data and publishing it avoids an immediate duplicate read:

- initial RSC-loaded data can seed fulfilled client promises
- a create response can make the created entity available to an exact detail key
- an update response can publish the confirmed entity to exact-key consumers
  while broader derived reads are invalidated

Confirmed value publication should use the same subscriber path as
invalidation. Conceptually, it is a prefilled invalidation:

```txt
put authoritative next promise in the entry
-> notify invalidation subscribers
-> mounted readers transition to the next promise through useLane
```

The difference from ordinary invalidation is only where the next promise comes
from. Ordinary invalidation lets the mounted reader create it from the current
loader. Confirmed value publication stores the next promise first, so the reader
observes that promise when it handles the same invalidation path.

## Optimistic State Is Local

Lane should intentionally differ from React Query-style optimistic cache
updates.

In React Query, optimistic data is often written into the shared query cache.
That makes the optimistic value immediately visible to every consumer of the
affected query data across the application.

Lane should not do that. Optimistic state should be local to the component or
workflow where the action happened, using React primitives such as
`useOptimistic`. The rest of the application should continue to render from the
current promise-backed data until the source is invalidated and re-read or an
authoritative server-confirmed value is published.

This means Lane does not try to make optimistic data globally consistent. The
global view converges only after the mutation result is confirmed and the
affected reads are invalidated and re-read or otherwise updated with
authoritative data.

This is an intentional design tradeoff:

- optimistic UI remains close to the user action that produced it
- Lane avoids a global optimistic cache and rollback/revert semantics
- distant consumers do not observe speculative data
- application-wide consistency comes from confirmed data, not optimistic patches

For the same reason, Lane intentionally ships no mutation helper. Mutations are
written with React primitives — `useActionState`, `useOptimistic`, and
transitions — exactly as they are next to Server Components and Server
Functions. Keeping one mental model is worth more long-term than a convenient
wrapper that diverges from it.

## Hook Result Shape

The preferred public hook name is `useLane`.

It may return promise-oriented helpers:

```ts
type LaneResult<T> = {
  promise: Promise<T>;
  refreshError: unknown;
  isBackgroundPending: boolean;
  isTransitionPending: boolean;
  invalidate: () => void;
};
```

It should not return query-result fields:

- `data`
- `error`
- `isLoading`
- `isError`
- `isSuccess`
- `status`

Data should be read by React with `use(promise)`. Errors should be handled by
Error Boundaries. Loading should be handled by Suspense fallback and transition
pending state.

`refreshError` is deliberately not `error`. Initial-load failures still reject
the promise and reach the Error Boundary. `refreshError` only reports a failed
refresh of an entry that already has data; the promise keeps resolving with the
last fulfilled value so the UI does not lose good data (see "Refresh Errors
Serve Stale Data").

## Refresh Errors Serve Stale Data

A failed refresh must not destroy data the user is already looking at.

When an entry has a last fulfilled value and its next read rejects — after an
invalidation, a focus refetch, or an authoritative `set` of a rejecting
promise — the cache falls back:

- the cached promise resolves with the last fulfilled value, so `use(promise)`
  keeps rendering data instead of throwing to the Error Boundary
- the failure is exposed separately as `refreshError` on the hook result
- freshness keeps the original fulfillment time, so staleness policies
  (`staleTime`, focus refetch, mount refetch) still treat the data as old and
  retry naturally
- the next successful read clears `refreshError`

Only initial loads — reads with no previous fulfilled value — reject the cached
promise and reach the Error Boundary. This preserves the boundary model for
"there is nothing to show" while keeping "there is something to show" rendered
during background failures.

## Query Lifecycle Hardening

Lifecycle behaviors that keep the promise model production-safe:

- **Garbage collection.** An entry with no subscribers is collected `gcTime`
  milliseconds after its last subscriber leaves (default five minutes,
  `Infinity` opts out). This also collects entries created by renders that
  never committed.
- **Abort.** Loaders receive `{ key, signal }`. The signal aborts when the
  in-flight read is discarded: invalidation, removal, an authoritative `set`
  over a pending read, or garbage collection. `update` adopts the in-flight
  result, so it does not abort.
- **Retry.** `retry` and `retryDelay` options retry failed loads (default: no
  retries, exponential backoff capped at 30s when enabled). Aborts stop the
  retry loop.
- **Structural sharing.** When a reload resolves with data deeply equal to the
  previous value, the previous references are reused so memoized consumers do
  not re-render for identical data.
- **Subscription catch-up.** Subscribing creates the entry when missing, and
  the hook reconciles with the store right after subscribing. Invalidations
  that land while a reader is suspended (and therefore not yet subscribed)
  converge instead of leaving the reader on a dropped promise.

## Deferred Key Changes

`useLane` should not defer key changes by default.

The primitive hook should treat the rendered key as the key it owns. Deferring
inside `useLane` would make it too easy for the key and loader to describe
different inputs. For example, a deferred key paired with a loader that captures
the current filter can store new-filter data under an old-filter key.

Deferral is still useful for search, filters, and sort controls where keeping the
previous result visible is acceptable. That should be explicit at the call site:

```tsx
const deferredFilter = useDeferredValue(filter);

const result = useLane(
  lane,
  filterToKey(deferredFilter),
  () => fetchTasks(deferredFilter),
);
```

The key and loader should be derived from the same deferred input. Debounce, when
needed for request rate control, should remain an application-level concern such
as local draft state followed by a debounced committed filter.

Lane does not need a `useDeferredLane` helper for the initial implementation. It
can be added later as a small adapter if repeated call sites justify it.

For key-driving state changes where preserving the previous result is desired,
the application should use a transition, a deferred input, or both. For urgent
identity changes such as sign out or team switch, the application should not hide
the change behind deferred key behavior; it should remove or unmount stale reads.

## Key Matching

Lane should support a practical key matching model:

- exact-key operations for one concrete read
- prefix or predicate scoped operations for groups of existing reads

Exact-key operations are appropriate for reads with one identity:

- `["task", taskId]`
- `["labels"]`
- `["projects"]`
- `["members"]`

Scoped operations are appropriate for families of reads:

- `["tasks", filters]` entries can be invalidated through the `["tasks"]`
  prefix
- team-scoped entries can be removed through a fixed set of prefixes

Prefix and predicate matching should apply to entries that already exist in the
Lane store. A scoped invalidation should not require the application to
enumerate every possible key that could exist; it should only invalidate matching
entries that have actually been created or seeded.

The caller chooses whether an operation is exact or scoped. Lane should not infer
that from the key shape.

Lane keys should remain structural. The implementation can derive a canonical
`keyId` for map lookups, but it should keep enough structural key information to
implement scoped matching correctly. Prefix matching should compare key segments,
not raw string prefixes.

Possible API shape:

```ts
lane.invalidate(key); // exact
lane.invalidateAll(prefixOrPredicate); // scoped

lane.set(key, valueOrPromise); // exact, authoritative value publication
lane.update(key, updater); // exact, update from the current fulfilled value
lane.updateAll(prefixOrPredicate, updater); // scoped, patch existing entries

lane.remove(key); // exact
lane.removeAll(prefixOrPredicate); // scoped
```

The names are provisional, but the distinction is intentional:

- exact operations affect one key
- scoped operations affect existing entries matched by prefix or predicate
- application code decides which operation is correct for the domain event

`set` is for authoritative values already in hand and does not depend on the
previous value. `update` and `updateAll` derive the next value from an existing
entry: fulfilled entries update immediately, pending entries chain the updater
onto the current promise, and rejected or missing entries are left alone.

`remove` is different from invalidation. It means the entry no longer belongs in
the current client state, such as after sign out, team switch, or deleting a
selected entity. Remove notifications should be urgent rather than transition
preserving: mounted readers should stop rendering the removed promise
immediately and either create a fresh promise or let the surrounding UI unmount
that read.

## Design Bias

When both are possible, prefer:

- invalidating source data over patching cache entries
- exact-key operations for single reads and scoped operations for existing key
  families
- exact-key publication only for authoritative values already in hand
- local React state for optimistic UI, not shared Lane cache writes
- app-level decisions for mutation effects
- Lane library APIs that coordinate promise identity rather than resolved-value
  cache policy
