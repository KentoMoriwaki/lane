# Lane useLane Reference Design

This note records the reference starting point for `useLane` in the RSC-seeded
client ownership architecture.

It is not a finalized implementation. It captures the intended direction so the
first Lane implementation can start from a concrete shape.

## Design Goal

`useLane` should connect Lane's keyed promise store to React state without making
an external mutable store read an implicit render dependency.

The hook should:

- return a promise that React can unwrap with `use`
- return transition pending state for Lane-driven invalidations
- return an exact-key invalidation helper
- keep the current promise in React state
- detect key changes during render and switch to the new key's promise
- subscribe to invalidation events for the current key
- re-read with the latest component-provided loader when invalidated
- never return `data`, `error`, `isLoading`, or query-status result objects
- avoid storing optimistic values in Lane
- avoid requiring Lane core to store every loader for later eager refetch

## Reference Shape

```ts
type LaneResult<T> = {
  promise: Promise<T>;
  isPending: boolean;
  invalidate: () => void;
};

type LaneUseOptions = {
  staleTime?: number;
  refetchOnMount?: boolean | "always";
};

type LaneInvalidateOptions = {
  staleTime?: number;
  onlyIf?: "stale" | "settled";
};

function useLane<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
  options?: LaneUseOptions,
): LaneResult<T> {
  const keyId = serializeKey(key);
  const [isPending, startTransition] = useTransition();

  const [promise, setPromise] = useState(() =>
    lane.readOrCreate<T>(keyId, loader),
  );
  const [prevKeyId, setPrevKeyId] = useState(keyId);

  let effectivePromise = promise;

  if (keyId !== prevKeyId) {
    const nextPromise = lane.readOrCreate<T>(keyId, loader);

    setPrevKeyId(keyId);
    setPromise(nextPromise);

    effectivePromise = nextPromise;
  }

  const onInvalidate = useEffectEvent((targetKeyId: string) => {
    startTransition(() => {
      setPromise(lane.readOrCreate<T>(targetKeyId, loader));
    });
  });

  const onRemove = useEffectEvent((targetKeyId: string) => {
    setPromise(lane.readOrCreate<T>(targetKeyId, loader));
  });

  useEffect(() => {
    const unsubscribeInvalidate = lane.onInvalidate(keyId, () => {
      onInvalidate(keyId);
    });
    const unsubscribeRemove = lane.onRemove(keyId, () => {
      onRemove(keyId);
    });

    return () => {
      unsubscribeInvalidate();
      unsubscribeRemove();
    };
  }, [lane, keyId]);

  const invalidate = useCallback(() => {
    lane.invalidate(keyId);
  }, [lane, keyId]);

  return {
    promise: effectivePromise,
    isPending,
    invalidate,
  };
}

function useLanePromise<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
  options?: LaneUseOptions,
): Promise<T> {
  return useLane(lane, key, loader, options).promise;
}
```

`useLane` is the preferred public shape. `useLanePromise` can exist as a thin
wrapper for call sites that only need the promise.

The hook should not return resolved data or error state. Data is read with
`use(promise)`, and errors are handled by Error Boundaries.

`refetchOnMount` is a lifecycle policy over the same promise cache. It should
not require Lane core to store loaders globally or expose a low-level reload API.
The hook can first render from `readOrCreate`, then ask Lane to conditionally
invalidate the cached promise. If the cache is cleared, mounted readers re-read
through the same subscription path.

## Lane Store Assumptions

The reference hook assumes a small Lane store contract:

```ts
lane.seed(keyId, valueOrPromise)
lane.seedMany(entries)
lane.readOrCreate(keyId, loader)
lane.invalidate(keyId, options?)
lane.invalidateAll(prefixOrPredicate, options?)
lane.set(keyId, valueOrPromise)
lane.update(keyId, updater)
lane.updateAll(prefixOrPredicate, updater)
lane.remove(keyId)
lane.removeAll(prefixOrPredicate)
lane.onInvalidate(keyId, listener)
lane.onRemove(keyId, listener)
```

This reference uses `keyId` to keep the hook mechanics concrete. A public Lane
API may accept structural `LaneKey` values and normalize them internally. The
implementation still needs a canonical id for exact lookup and enough structural
key information to perform prefix or predicate matching without relying on raw
string prefix checks.

`seed` should behave like initialization:

- if no cache exists for the key, wrap the value or promise in a promise and
  store it
- if a cache already exists for the key, do nothing
- repeated seed calls must not overwrite data created by later client reads,
  invalidations, sets, or updates

`seedMany` should apply the same set-only-if-no-cache rule to each exact entry.

`readOrCreate` should behave like this:

- if the key's entry has a cache, return the cached promise
- if the key's entry has no cache, call `loader`, store the promise, and return
  it

It should not perform stale-time, invalidation, or reload policy. It only reads
or creates the cached promise.

`invalidate` should behave like this:

- if no entry exists, do nothing
- if an entry exists and the invalidation policy does not match, do nothing
- if an entry exists and the policy matches, clear `entry.cache` and notify
  subscribers

The subscribed `useLane` reader owns the current loader and creates the next
promise when it handles the invalidation through `readOrCreate`. Multiple
readers for the same key are naturally deduped because the first reader creates
the new cache and later readers return it.

Invalidating an absent entry can be a no-op. Lane does not need to create an
invalid placeholder for a key that has never been read or seeded.

`set` should behave like a prefilled invalidation: store the authoritative next
promise first, then notify invalidation subscribers. The `useLane` reader can
handle it through the same re-read path; `readOrCreate` returns the already
stored promise.

`remove` should delete the entry and notify remove subscribers. Remove is urgent:
the reader should not preserve the removed promise through a transition.
Removing an absent entry can be a no-op.

If subscribers exist for the key, Lane can keep the key slot alive and clear only
`entry.cache`. This preserves exact-key subscriptions while ensuring the removed
promise is no longer cached.

`invalidateAll` and `removeAll` should only operate on entries that already
exist. They should notify the exact-key subscribers for each matching entry.

## Key Change Behavior

The hook keeps `prevKeyId` separate from `promise`.

`prevKeyId` is only for detecting that the rendered key changed. It should not be
combined with the promise into a larger state object. The hook should not keep a
history of old promises. Once a promise is no longer referenced by the hook or
Lane store, it can be garbage collected normally.

On key change:

```txt
render with new key
-> detect keyId !== prevKeyId
-> readOrCreate the new key's promise with the current loader
-> update prevKeyId and promise state
-> return the new promise for the current render
```

This mirrors controlled state synchronization during render and avoids returning
the old key's promise for one extra render.

## Deferred Key Changes

The reference hook should not call `useDeferredValue` for the key internally.
`useLane` should be the primitive that owns the rendered key exactly as provided.

When a call site wants deferred behavior for search, filters, or sort controls,
it should defer the input before deriving both the key and loader:

```tsx
const deferredFilter = useDeferredValue(filter);

const { promise, isPending } = useLane(
  lane,
  filterToKey(deferredFilter),
  () => fetchTasks(deferredFilter),
);
```

The important constraint is that the key and loader must be based on the same
input. Deferring only the key while the loader captures current state can store
data under the wrong key.

`useDeferredLane` is not required for the initial implementation. If repeated
call sites need it later, it should be an adapter over `useLane`, not behavior
hidden inside `useLane`.

## Invalidation Behavior

On invalidation:

```txt
mutation confirms source changed
-> lane.invalidate(keyId) or lane.invalidateAll(scope)
-> Lane clears cache for matching entries and notifies current subscribers
-> useLane receives the invalidation event
-> startTransition schedules promise replacement
-> readOrCreate uses the latest loader from this component
-> component renders from the next promise
```

The important point is that Lane core does not need to remember the loader in
order to refetch later. The reader that currently owns the async read provides
the loader.

## Set Behavior

On set:

```txt
application has authoritative next value or promise
-> lane.set(keyId, valueOrPromise)
-> Lane normalizes it to a promise and stores it in the entry
-> Lane notifies invalidation subscribers
-> useLane handles it through the same transition path as invalidation
-> readOrCreate returns the already stored promise on the next read
-> component renders from the authoritative promise
```

Set is not an optimistic update mechanism. It is authoritative data publication.

## Update Behavior

On update:

```txt
application has a patch for an existing value
-> lane.update(keyId, updater) or lane.updateAll(prefixOrPredicate, updater)
-> Lane chains the updater onto the current cached promise
-> known rejected or missing entries are not changed
-> Lane notifies invalidation subscribers for changed entries
-> readOrCreate returns the already stored updated promise on the next read
-> component renders from the updated promise
```

Lane does not need to keep a resolved value store to support `update`. The update
operation can replace the cached promise with a derived promise from
`entry.cache.promise.then(current => updater(current, entryInfo))`.

## Removal Behavior

On removal:

```txt
entry no longer belongs in current client state
-> lane.remove(keyId) or lane.removeAll(scope)
-> Lane clears cache for matching entries and notifies current subscribers
-> useLane handles removal urgently, without startTransition
-> mounted reader stops using the removed promise immediately
```

If the component still renders the same read after removal, it may create a fresh
promise from the current loader. If the surrounding UI unmounts the read and no
cache exists, the key slot can be deleted.

## React Compiler Constraint

The hook should not depend on reading mutable Lane store state during render as
an implicit dependency. In particular, it should avoid a design where render
calls `lane.get(key, loader)` and expects the result to change merely because the
external store's invalidated flag changed.

The reference shape uses React state and subscriptions instead:

- render returns the current React-state promise
- key changes are handled explicitly
- invalidations enter React through subscription callbacks
- promise replacement happens through React state updates

This should be more robust with React Compiler than treating the Lane store as a
hidden render dependency.

## Optimistic State

This hook is not an optimistic state mechanism.

Optimistic UI should stay local to the component or workflow that initiated the
action, using React primitives such as `useOptimistic`. Lane should only publish
promises for current source data or authoritative values the application already
has.

## Minimum Implementation Checklist

The first implementation should be able to prove these behaviors before the app
replacement work depends on it:

- stable structural key serialization, including sorted plain-object properties
- exact lookup by canonical key id
- scoped matching over existing entries by structural prefix or predicate
- `seed` / `seedMany` set only absent entries
- `readOrCreate` returns the existing cached promise for the same key
- invalidation clears the cached promise and mounted readers create the next
  promise by re-reading with their current loader
- exact invalidation notifies only subscribers for that exact key
- scoped invalidation notifies exact subscribers for each matching existing entry
- `set` stores an authoritative promise and then uses the invalidation
  subscriber path
- `remove` clears cache and notifies remove subscribers urgently
- `useLane` keeps the current promise in React state and returns no query-result
  fields
- `useLane` does not defer keys internally
- optimistic state never enters the Lane store
