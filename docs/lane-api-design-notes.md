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

## Initial Seeding

Lane needs an explicit initial seeding operation for the RSC-seeded client
ownership architecture.

Seeding is initialization, not mutation convergence. A Server Component can load
initial data, pass it to a Client Component, and that client boundary can seed
Lane before normal client reads begin.

Possible API shape:

```ts
lane.seed(key, valueOrPromise); // exact, set only if absent
lane.seedMany(entries); // exact entries, set only if absent
```

Seed must be idempotent:

- if no entry exists, store a promise for the seeded value
- if an entry already exists, do nothing
- repeated provider renders and Strict Mode behavior must not overwrite newer
  client-owned entries

Seed should not be used as cache patching after mutations. Once the client owns
the read, convergence should use invalidation or confirmed value publication.

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

## Hook Result Shape

The preferred public hook name is `useLane`.

It may return promise-oriented helpers:

```ts
type LaneResult<T> = {
  promise: Promise<T>;
  isPending: boolean;
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
lane.seed(key, valueOrPromise); // exact, set only if absent
lane.seedMany(entries); // exact entries, set only if absent

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
