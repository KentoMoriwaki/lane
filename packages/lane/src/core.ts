import { isPrefixKey, serializeKey } from "./keys";
import {
  isExternalLoader,
  LaneOwnershipError,
  publicationReason,
} from "./ownership";
import { LaneReadError } from "./read-error";
import { replaceEqualDeep } from "./structural";
import type {
  Lane,
  LaneEntryInfo,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneLoaderMeta,
  LaneLoaderMetaArgs,
  LaneOptions,
  LaneRead,
  LaneReadSpec,
  LaneScope,
  LaneUpdater,
  LaneValue,
  LaneWhenStale,
} from "./types";

export type LaneInvalidationSource = "background" | "transition";

export type LaneReadOptions = {
  staleTime?: number;
  whenStale?: LaneWhenStale;
  /**
   * The lane's `loaderMeta`, handed to the loader as `context.meta`. It rides in
   * the read options rather than in the read because it belongs to the lane, not
   * to the definition — which is what keeps a read's arguments to exactly what
   * decides its key. Nothing here reads it: it is threaded to `runLoader` and
   * never participates in cache reuse.
   */
  loaderMeta?: LaneLoaderMeta;
};

type LaneSubscription = (
  entry: LaneEntryInfo,
  source: LaneInvalidationSource,
) => void;

type LaneRemoveSubscription = (entry: LaneEntryInfo) => void;

/**
 * "An invalidation is coming for your key — open its transition now."
 *
 * Separate from {@link LaneSubscription} because it is the one notification that
 * does not describe a cache: no source to pick a surface with (this is always
 * the explicit one), and nothing to re-read. A subscriber that acts on it
 * schedules nothing — see `useLane`, where an empty `startTransition` is the
 * whole handler, and the flag it raises is the `isInvalidationPending` this is
 * named after.
 */
type LaneInvalidationPendingSubscription = (entry: LaneEntryInfo) => void;

// A subscriber is a pure notify hook plus a GC anchor — it carries no policy.
// When to revalidate (focus / reconnect / mount / stale) is the reader's
// concern, expressed as per-read invalidations; the store only notifies. Even
// focus / reconnect stay out of here — they are DOM concerns the provider owns.
export type LaneSubscriber = {
  onInvalidate?: LaneSubscription;
  onInvalidationPending?: LaneInvalidationPendingSubscription;
  onRemove?: LaneRemoveSubscription;
};

type LaneState = {
  entries: Map<string, LaneEntry>;
  gcTime: number;
  sweepTimer: ReturnType<typeof setInterval> | undefined;
  /**
   * Mints {@link LaneEntry.revision} values, one counter for the whole lane.
   * Lane-wide rather than per-entry so that an entry evicted and re-created can
   * never re-issue a number an older generation of the same key already used —
   * a reader that folds a revision into another key's arguments would otherwise
   * hit that key's stale cache and read it as current.
   */
  revisionCounter: number;
};

type LanePromiseSettlement = {
  at: number;
  kind: "fulfilled" | "rejected";
};

type LanePromiseCache = {
  /**
   * The read itself: the promise for a client-owned entry, and a weak reference
   * to it for an external one, whose value the lane does not keep alive (see
   * {@link cacheSlot}). Which of the two is decided by the entry, never by
   * inspecting this — `entry.external` says how to read the slot, and marking an
   * entry external converts the slot it already had, so the two cannot disagree.
   *
   * A client-owned entry holds the promise directly rather than through a
   * wrapper, because every entry in every app has one of these and almost none
   * of them are external.
   */
  promise: Promise<unknown> | LaneWeakSlot;
  settlement: LanePromiseSettlement | undefined;
  startedAt: number;
  controller: AbortController | undefined;
  // Whether a reader has ever committed on *this* cache — set when one
  // subscribes while it is current, and true from birth for a cache installed
  // while the key already has a live reader.
  //
  // It is per-cache rather than per-entry because it guards a suspense retry: an
  // uncommitted read has no subscriber, so an entry-wide "has ever been
  // subscribed" flag stops protecting the moment the key has been mounted once,
  // and `whenStale: "refetch"` then re-judges its own just-settled value stale on
  // every retry and refetches forever.
  adopted: boolean;
  // Set by `cancel` on a read that is still in flight. Every other abort path
  // displaces the cache in the same breath, so a late settlement is already
  // dropped by the identity check below; a cancel deliberately leaves the cache
  // in place to revert to the previous value, which puts its settlement
  // handlers back in play. They read this to fold the settlement into the
  // fallback — so a loader that ignores its `signal` and runs to completion
  // cannot undo a cancel.
  cancelled: boolean;
};

type LaneEntry = {
  key: LaneKey;
  keyId: string;
  cache: LanePromiseCache | undefined;
  subscribers: Set<LaneSubscriber>;
  lastFulfilled: { value: unknown; at: number } | undefined;
  // Timestamp the entry last had zero subscribers (set on creation and on the
  // last unsubscribe; cleared while subscribed). The central GC sweep evicts
  // entries idle for longer than the lane's gcTime.
  idleSince: number | undefined;
  /**
   * The identity of the content this entry currently holds — advanced (from the
   * lane-wide counter) exactly when a fulfillment's value is a *new reference*,
   * which structural sharing has already decided: a refetch that came back
   * deep-equal kept the old reference and keeps the old revision. An external
   * entry has no previous value to compare against, so every publication
   * advances it — publication identity, the strongest claim the client can
   * make about content it does not own (see {@link rememberFulfilled}). `0`
   * until the first fulfillment, which no settled read ever shows.
   */
  revision: number;
  /**
   * Whether this key's value comes from outside: read with `external`, or seeded
   * by a publication (see `hydrate.ts`, which marks everything it seeds). It
   * decides two things and nothing else — the client mutation surface throws on
   * it, and its retention is delegated to reachability rather than to `gcTime`.
   *
   * It is one-way. A key someone declared external stays external for as long as
   * the shell lives: the second reader of a key cannot be the one that decides
   * nobody owns it.
   */
  external: boolean;
};

export const DEFAULT_GC_TIME = 5 * 60_000;

const laneStates = new WeakMap<Lane, LaneState>();

export function createLane(options: LaneOptions = {}): Lane {
  const state: LaneState = {
    entries: new Map(),
    gcTime: options.gcTime ?? DEFAULT_GC_TIME,
    revisionCounter: 0,
    sweepTimer: undefined,
  };

  const lane: Lane = {
    prefetch<T, C = T>(read: LaneReadSpec<T, C>, ...args: LaneLoaderMetaArgs) {
      // Warm the cache without subscribing or suspending: start the load and
      // hand back the promise for a later reader to adopt. Pin "revalidate" so a
      // re-fired prefetch (e.g. repeated link hover) dedupes onto the in-flight
      // or settled cache instead of refetching. Like any read it arms no GC
      // timer — an unadopted prefetch is an orphan, reclaimed by the lane-wide
      // sweep on whatever cycle a later unsubscribe triggers.
      //
      // A read's `staleTime` / `whenStale` are deliberately ignored here: those
      // are read-time decisions and this is not the read.
      if (isExternalLoader(read.loader)) {
        // Rejected by `LaneReadSpec`'s loader type as well; this catches the
        // spec that reached here as `any` or through a cast. Warming an
        // external key would start a wait whose only outcome is the timeout.
        throw new LaneOwnershipError(
          read.key,
          serializeKey(read.key),
          "prefetch",
        );
      }

      return readOrCreate<T, C>(lane, serializeKey(read.key), read.key, read.loader, {
        // Same precedence as a hook read: the read's own override wins over the
        // value supplied alongside it.
        loaderMeta: read.loaderMeta ?? args[0]?.loaderMeta,
        whenStale: "revalidate",
      });
    },
    startInvalidationTransition(scope) {
      startScopeInvalidationTransition(state, scope);
    },
    invalidate(key, options = {}) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      invalidateLaneEntry(state, entry, options, invalidationSource(options));
    },
    invalidateAll(scope, options = {}) {
      const source = invalidationSource(options);

      for (const entry of matchingEntries(state.entries, scope)) {
        invalidateLaneEntry(state, entry, options, source);
      }
    },
    set<T>(key: LaneKey, valueOrPromise: LaneValue<T>) {
      assertClientOwned(
        getOrCreateEntry(state, key, serializeKey(key)),
        "set",
      );

      return publishEntry<T>(lane, key, valueOrPromise);
    },
    update<T>(key: LaneKey, updater: LaneUpdater<T>) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return undefined;
      }

      assertClientOwned(entry, "update");

      return updateLaneEntry(state, entry, updater);
    },
    updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>) {
      const entries = matchingEntries(state.entries, scope);

      // Checked over the whole match before anything is written, so a scope that
      // happens to reach a published key is refused rather than half-applied.
      // (`invalidateAll` cannot do the same: whether it touches an entry at all
      // is `onlyIf`'s decision, entry by entry.)
      assertScopeClientOwned(entries, "updateAll");

      return entries.flatMap((entry) => {
        const promise = updateLaneEntry(state, entry, updater);
        return promise ? [promise] : [];
      });
    },
    remove(key) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      assertClientOwned(entry, "remove");
      removeLaneEntry(state, entry);
    },
    removeAll(scope) {
      const entries = matchingEntries(state.entries, scope);

      assertScopeClientOwned(entries, "removeAll");

      for (const entry of entries) {
        removeLaneEntry(state, entry);
      }
    },
    cancel(key) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      cancelLaneEntry(entry);
    },
  };

  laneStates.set(lane, state);

  return lane;
}

/**
 * Publish a value under a key as the entry's authoritative content, and announce
 * it — `lane.set` addressed by key rather than by an entry the caller already
 * holds, which is what the publication path (`hydrate.ts`) needs.
 *
 * `external` says the value came from outside, marking the key as one the client
 * may not write to and whose retention is reachability's business rather than
 * `gcTime`'s. Not exported from the package: publishing on someone else's behalf
 * is an internal seam, and `lane.set` is the public way to publish your own.
 */
export function publishEntry<T>(
  lane: Lane,
  key: LaneKey,
  valueOrPromise: LaneValue<T>,
  external = false,
): Promise<LaneRead<T>> {
  const state = getLaneState(lane);
  const entry = getOrCreateEntry(state, key, serializeKey(key));

  if (external) {
    markExternal(entry);
  }

  const promise = publishEntryValue(state, entry, valueOrPromise);

  notifyInvalidate(entry, "transition");

  return promise;
}

/**
 * Record that this key is filled from outside, once. Converting the cache it
 * already holds is what keeps `entry.external` a sound description of the slot:
 * a key read with a client loader first and `external` second would otherwise be
 * an entry that says "weak" over a bare promise.
 */
function markExternal(entry: LaneEntry): void {
  if (entry.external) {
    return;
  }

  entry.external = true;

  if (entry.cache) {
    entry.cache.promise = externalRef(entry.cache.promise as Promise<unknown>);
  }
}

/**
 * Addressed by canonical id, like every internal entry API — the id is what a
 * hook's effects hold and depend on, so it is what they hand over. The key
 * object rides along as creation material only: the entry may not exist (or may
 * have been removed) and a shell without its key could never answer a prefix
 * match or hand its loader real arguments. `keyId` must be `serializeKey(key)`;
 * callers hold both already, so the pair travels instead of being re-derived.
 */
export function readOrCreate<T, C = T>(
  lane: Lane,
  keyId: string,
  key: LaneKey,
  loader: LaneLoader<T, C>,
  options?: LaneReadOptions,
): Promise<LaneRead<T>> {
  const state = getLaneState(lane);
  const entry = getOrCreateEntry(state, key, keyId);

  // The one place the store asks *which* loader it was handed: reading a key
  // with `external` declares that it is filled from outside. Nothing downstream
  // branches on the loader again — the wait is a loader like any other — but the
  // entry's mutation surface and its retention both hang off whose value this
  // is.
  if (isExternalLoader(loader)) {
    markExternal(entry);
  } else if (
    // The two claims of ownership meeting, which is the one moment either side
    // can see the other. A publication marks the key it seeds (`hydrate.ts`),
    // and this read says it fetches the same key itself — so one of the two is a
    // mistake, and nothing downstream will say which: the read *works*, it just
    // works with none of a client-owned entry's guarantees, until the first
    // write throws somewhere else entirely.
    //
    // Checked here rather than where the seed is written because this is the
    // only place both facts exist. A publication is addressed by key, and a key
    // does not carry its loader — `laneSnapshot` takes a read for ergonomics,
    // but its plain-key forms carry nothing to check, so a check on that side
    // would cover some spellings of the same mistake and not others.
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    entry.external
  ) {
    warnDev(
      `${keyId} is filled from outside — a publication seeded it, or another ` +
        "read declares `loader: external` for it — but this read supplies a " +
        "client loader. A key that is published is the publisher's: its value " +
        "is held weakly rather than for `gcTime`, `set` / `update` / " +
        "`invalidate` / `remove` throw on it, and what this loader returns is " +
        "stored with none of a client-owned entry's guarantees — no " +
        "stale-on-error fallback, no `current` for the next load, no structural " +
        "sharing. Read it with `loader: external` and let its owner republish, " +
        "or stop seeding the key and let the client own it.",
    );
  }

  const reusable = reuseCache(entry, options);

  if (reusable) {
    return reusable as Promise<LaneRead<T>>;
  }

  const controller = new AbortController();
  // Snapshot the last fulfilled value now, so a publication landing between here
  // and the loader's first call cannot change what the read was started from. It
  // outlives invalidation (which clears the cache, not `lastFulfilled`) and is
  // `undefined` once the entry itself is gone.
  const current = entry.lastFulfilled?.value as C | undefined;
  const promise = runLoader(loader, key, controller.signal, options, current);

  return setEntryCache(state, entry, promise, controller);
}

/**
 * Whether a read reuses the cached promise.
 *
 * `"revalidate"` (default) always reuses an existing cache — staleness is
 * refreshed separately in the background, so a reader shows the cached value
 * and converges through a transition (the long-standing behavior).
 *
 * `"refetch"` discards a stale value and suspends on a fresh read, but never
 * discards an in-flight read (would break same-transition sharing), a value a
 * live subscriber is showing (would yank a shared promise from active readers),
 * or a fulfilled value *no reader has committed on* — that last case is a
 * pre-commit suspense retry (or a first adoption of a prefetched/hydrated
 * value), not a remount, and discarding it would loop forever: React re-reads on
 * each retry, re-judges the just-settled value stale, and refetches without ever
 * committing. So a stale fulfilled value is only discarded on a genuine idle
 * remount of previously-live data.
 *
 * A rejection is never discarded here. Retrying is an event — a mount, a
 * trigger, an `invalidate` — and a render is not one: React may render a
 * suspended reader any number of times and throw the work away, so a retry
 * decided during render fires again on every attempt. The reader would then
 * receive a fresh pending promise each time and suspend instead of throwing,
 * which means the failure never reaches the boundary and the loop never ends.
 * The fulfilled path above escapes this only because its discard produces an
 * unadopted cache, which the guard below then refuses to discard again; a
 * rejection has no such stopping property, so it is not started.
 *
 * Adoption is tracked per *cache*, not per entry. An entry-wide "has ever been
 * subscribed" flag looks equivalent and is not: it stays true once the key has
 * been mounted at all, so the retry after a remount's *own* refetch is judged a
 * remount too — and the loop this guard exists to prevent reappears on the
 * second visit to any key.
 *
 * An external entry adds one case before any of that: its value may simply be
 * *gone*. Nothing else changes — a collected value reads as an absent one, so
 * the read goes through the loader (which, being `external`, waits for the next
 * publication) exactly as it would for a key never read before.
 */
function reuseCache(
  entry: LaneEntry,
  options: LaneReadOptions | undefined,
): Promise<unknown> | undefined {
  const cache = entry.cache;

  if (!cache) {
    return undefined;
  }

  const promise = cachedPromise(entry, cache);

  if (promise === undefined) {
    // Pruned here rather than on a timer, the way the router evicts its own
    // caches: the read is the moment the shell's emptiness first matters, and
    // an unread dead shell costs a map slot until then.
    entry.cache = undefined;

    return undefined;
  }

  if ((options?.whenStale ?? "revalidate") !== "refetch") {
    return promise;
  }

  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    options?.staleTime === undefined
  ) {
    warnDev(
      '`whenStale: "refetch"` discards a stale value on an idle remount, but ' +
        "`staleTime` defaults to Infinity, so nothing is ever stale and the read " +
        'always reuses the cache — the same as the default "revalidate". Set a ' +
        "`staleTime` to say how long a value stays fresh.",
    );
  }

  if (cache.settlement === undefined || entry.subscribers.size > 0) {
    return promise;
  }

  // Never adopted → a pre-commit retry or a first prefetch/hydration read, not a
  // remount; reuse so it can't loop. Only a value some reader actually committed
  // on is stale enough to throw away.
  if (!cache.adopted) {
    return promise;
  }

  return isStale(cache, options?.staleTime) ? undefined : promise;
}

export function invalidateEntry(
  lane: Lane,
  keyId: string,
  options: LaneInvalidateOptions = {},
  source: LaneInvalidationSource = "transition",
): void {
  const state = getLaneState(lane);
  const entry = state.entries.get(keyId);

  if (!entry) {
    return;
  }

  invalidateLaneEntry(state, entry, options, source);
}

/**
 * `Lane.update` addressed by canonical id instead of key — the update-side twin
 * of `invalidateEntry`. A hook already holds the serialized id and would
 * otherwise have to keep the key array alive just to re-serialize it, which
 * makes the key a dependency of every callback that writes to the entry.
 */
export function updateEntry<T>(
  lane: Lane,
  keyId: string,
  updater: LaneUpdater<T>,
): Promise<LaneRead<T>> | undefined {
  const state = getLaneState(lane);
  const entry = state.entries.get(keyId);

  if (!entry) {
    return undefined;
  }

  assertClientOwned(entry, "update");

  return updateLaneEntry(state, entry, updater);
}

/**
 * Same id-plus-key contract as {@link readOrCreate}: the id addresses, the key
 * is the material for the entry this subscribe may have to (re)create.
 */
export function subscribeLane(
  lane: Lane,
  keyId: string,
  key: LaneKey,
  subscriber: LaneSubscriber,
): () => void {
  const state = getLaneState(lane);
  const entry = getOrCreateEntry(state, key, keyId);

  entry.subscribers.add(subscriber);
  entry.idleSince = undefined; // active: not a GC candidate

  if (entry.cache) {
    // This reader committed on the cache it is holding, so a later idle read of
    // that same cache is a true remount rather than a retry.
    entry.cache.adopted = true;
  }

  return () => {
    entry.subscribers.delete(subscriber);

    if (entry.subscribers.size > 0) {
      return;
    }

    if (entry.external) {
      // Lane does not time an external entry out, because it does not know what
      // the value is worth: the publisher and the readers do, and both of them
      // hold it. Idleness says nothing here — the shell stays, and whether it
      // still points at anything is settled by reachability, checked on read.
      return;
    }

    if (!entry.cache) {
      // No cache and no subscribers: nothing worth keeping, drop now.
      if (state.entries.get(entry.keyId) === entry) {
        state.entries.delete(entry.keyId);
      }

      return;
    }

    // Idle with a cache: retained for reuse, collected by the central sweep
    // once it has been idle for the lane's gcTime.
    entry.idleSince = Date.now();
    ensureSweep(state);
  };
}

/**
 * The promise the entry currently holds, if any — the loader-free read-back
 * behind the bound `invalidate`, for the invalidation that notified nobody: an
 * `onlyIf` that declined cleared nothing, so the current cache *is* "the key's
 * value after this call". Deliberately not a public read API (the store returns
 * promises to readers, never data, and this returns only what a read already
 * created); addressed by canonical id like every internal entry API.
 */
export function peekEntryPromise(
  lane: Lane,
  keyId: string,
): Promise<unknown> | undefined {
  const entry = getLaneState(lane).entries.get(keyId);
  const cache = entry?.cache;

  return entry && cache ? cachedPromise(entry, cache) : undefined;
}

export function onInvalidate(
  lane: Lane,
  key: LaneKey,
  listener: LaneSubscription,
): () => void {
  return subscribeLane(lane, serializeKey(key), key, { onInvalidate: listener });
}

export function onRemove(
  lane: Lane,
  key: LaneKey,
  listener: LaneRemoveSubscription,
): () => void {
  return subscribeLane(lane, serializeKey(key), key, { onRemove: listener });
}

function invalidateLaneEntry(
  state: LaneState,
  entry: LaneEntry,
  options: LaneInvalidateOptions,
  source: LaneInvalidationSource,
): void {
  if (!shouldInvalidateEntry(entry, options)) {
    return;
  }

  // After the `onlyIf` gate, not before: an invalidation that would not have
  // done anything has not reached into anyone's ownership. That is what keeps a
  // revalidation trigger (`refetchOnMount` / focus / reconnect) from throwing out
  // of an effect merely for being configured on a reader that happens to sit
  // over a published key — while a trigger that *would* discard the owner's
  // value still fails, because that is the violation.
  assertClientOwned(entry, "invalidate");

  removeEntryCache(entry);
  notifyInvalidate(entry, source);
  cleanupEntry(state, entry);
}

function removeLaneEntry(state: LaneState, entry: LaneEntry): void {
  removeEntryCache(entry);
  // Drop the last fulfilled value too. `remove` means the entry no longer
  // belongs in client state — sign out, team switch, a deleted entity — and
  // `cleanupEntry` cannot enforce that alone: an entry a reader still holds
  // survives the removal, so anything left on it outlives the sign-out. That
  // value is the stale-on-error fallback *and* the `current` handed to the next
  // loader, either of which would serve the removed data back.
  entry.lastFulfilled = undefined;
  notifyRemove(entry);
  cleanupEntry(state, entry);
}

/**
 * Stop an in-flight read without converging the key.
 *
 * Every other abort is a consequence of the cached promise being displaced, so
 * the key always ends up with something newer. Cancelling is the one case where
 * stopping *is* the intent, which makes it the only operation that must not
 * notify: announcing it would make subscribed readers re-read, turning "stop"
 * into "start again". Readers keep the promise they already hold and it settles
 * underneath them.
 *
 * The cache is always left in place, and that is what makes the stop stick. A
 * transition has no third outcome: it commits, or it commits an error boundary.
 * So a cancelled read still has to settle into one of those, and which one is
 * decided by what the key already had:
 *
 * - a previous value — the settlement handlers fold the abort into it. Readers
 *   keep showing the data they had, and the entry stays exactly as stale as it
 *   was (freshness keeps the original fulfillment time, so a later staleness
 *   policy still refreshes it).
 * - nothing to revert to — the read settles rejected, which is the only end a
 *   transition with no data can reach. Emptying the entry instead would look
 *   tidier and quietly undo the cancel: a reader mid-transition is still trying
 *   to reach that key, React retries the render it never committed, and an empty
 *   entry turns that retry into a fresh load. Keeping the rejection is what lets
 *   the retry terminate.
 *
 * The rejection is then as sticky as any other failed first load — reused until
 * the key is invalidated, removed, collected, or read with
 * `whenStale: "refetch"`. That is deliberately not special-cased: a cancelled
 * first load recovers the same way every other one does.
 *
 * A settled cache is a value (or an error) the key holds, not a request in
 * progress, so it is left alone — discarding one is what `invalidate` and
 * `remove` are for.
 */
function cancelLaneEntry(entry: LaneEntry): void {
  const cache = entry.cache;

  if (!cache || cache.settlement !== undefined) {
    return;
  }

  cache.cancelled = true;
  cache.controller?.abort();
}

function updateLaneEntry<T>(
  state: LaneState,
  entry: LaneEntry,
  updater: LaneUpdater<T>,
): Promise<LaneRead<T>> | undefined {
  const cache = entry.cache;
  const promise = cache && cachedPromise(entry, cache);

  if (!cache || !promise || cache.settlement?.kind === "rejected") {
    return undefined;
  }

  const info = { key: entry.key, keyId: entry.keyId };
  const valueOrPromise = promise.then((current) =>
    updater((current as LaneRead<T>).data, info),
  );
  // The updater adopts the in-flight result, so the previous controller must
  // stay un-aborted and keeps guarding the chained cache.
  const updated = setEntryCache(state, entry, valueOrPromise, cache.controller);

  notifyInvalidate(entry, "transition");

  return updated;
}

function publishEntryValue<T>(
  state: LaneState,
  entry: LaneEntry,
  valueOrPromise: LaneValue<T>,
): Promise<LaneRead<T>> {
  // The read being replaced is aborted, as it always was — but an external one
  // is told *what* replaced it, on the abort itself. A publication is the value
  // that read was waiting for, so it ends as a fulfilled read rather than an
  // abandoned one, and that is the only thing that reaches a reader suspended on
  // it: uncommitted, therefore not a subscriber, and retried by React only when
  // the promise it suspended on settles.
  //
  // Only an external entry's abort carries the reason. A client loader's read is
  // aborted exactly as before, so nothing it might do with `signal.reason`
  // changes — and `abort(undefined)` is `abort()`, so there is no third case
  // here.
  entry.cache?.controller?.abort(
    entry.external ? publicationReason(valueOrPromise) : undefined,
  );

  return setEntryCache(state, entry, valueOrPromise, undefined);
}

function cleanupEntry(state: LaneState, entry: LaneEntry): void {
  if (entry.cache || entry.subscribers.size > 0) {
    return;
  }

  state.entries.delete(entry.keyId);
}

function notifyInvalidate(
  entry: LaneEntry,
  source: LaneInvalidationSource,
): void {
  const info = entryInfo(entry);

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onInvalidate?.(info, source);
  }
}

/**
 * Open the invalidation transition of every reader in a scope, without touching
 * a cache. The whole point is that nothing is stored: a notification that
 * *replaced* the cache would make readers re-read now, against a source the
 * caller has not changed yet, which is the pre-mutation data. So this schedules
 * no work and answers no question about the entry — it only reaches subscribers,
 * and what they do with it is open their transition.
 *
 * Checked over the whole match before anything is announced, for the reason
 * `updateAll` is: a scope that happens to reach a published key is refused
 * rather than half-applied. Announcing one is the same claim `invalidate` makes
 * and cannot back — the client does not know whether a publication is coming.
 */
function startScopeInvalidationTransition(
  state: LaneState,
  scope: LaneScope,
): void {
  const entries = matchingEntries(state.entries, scope);

  assertScopeClientOwned(entries, "startInvalidationTransition");

  for (const entry of entries) {
    notifyInvalidationPending(entry);
  }
}

function notifyInvalidationPending(entry: LaneEntry): void {
  const info = entryInfo(entry);

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onInvalidationPending?.(info);
  }
}

function notifyRemove(entry: LaneEntry): void {
  const info = entryInfo(entry);

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onRemove?.(info);
  }
}

function getOrCreateEntry(
  state: LaneState,
  key: LaneKey,
  keyId: string,
): LaneEntry {
  const existing = state.entries.get(keyId);

  if (existing) {
    return existing;
  }

  const entry = createEntry(key, keyId);
  state.entries.set(keyId, entry);

  return entry;
}

function getLaneState(lane: Lane): LaneState {
  const state = laneStates.get(lane);

  if (!state) {
    throw new TypeError("Unknown Lane instance");
  }

  return state;
}

function entryInfo(entry: LaneEntry): LaneEntryInfo {
  return {
    key: entry.key,
    keyId: entry.keyId,
  };
}

function noop(): void {}

/**
 * What a cancelled read rejects with when its loader ignored the signal and
 * resolved anyway — the case where there is no abort error to propagate.
 *
 * A shared instance: it carries no per-read information, and a cancellation is
 * not a failure worth a stack trace. A plain `Error` rather than a
 * `DOMException` so it works wherever Lane runs (Hermes has no `DOMException`).
 */
const CANCELLED = new Error("Lane read cancelled");

function matchingEntries(
  entries: Map<string, LaneEntry>,
  scope: LaneScope,
): LaneEntry[] {
  const matches =
    typeof scope === "function"
      ? scope
      : (entry: { key: LaneKey }) => isPrefixKey(scope, entry.key);

  return [...entries.values()].filter((entry) =>
    matches({ key: entry.key, keyId: entry.keyId }),
  );
}

function runLoader<T, C>(
  loader: LaneLoader<T, C>,
  key: LaneKey,
  signal: AbortSignal,
  options: LaneReadOptions | undefined,
  current: C | undefined,
): Promise<T> {
  // Started off a resolved promise rather than called outright, so a loader that
  // throws synchronously rejects the read like any other failure instead of
  // throwing out of the render that created it. Reading `loaderMeta` inside that
  // callback is safe where `current` had to be snapshotted: `options` is built
  // fresh per read and held by nobody, so nothing can move it across the defer.
  return Promise.resolve().then(() =>
    loader({
      current,
      key,
      meta: options?.loaderMeta as LaneLoaderMeta,
      signal,
    }),
  );
}

function createEntry(
  key: LaneKey,
  keyId: string,
): LaneEntry {
  return {
    cache: undefined,
    external: false,
    idleSince: Date.now(), // born idle: reclaimable as an orphan by a later sweep
    key,
    keyId,
    lastFulfilled: undefined,
    revision: 0,
    subscribers: new Set(),
  };
}

/**
 * The client mutation surface, closed on an entry whose value came from outside.
 * Thrown in production as well as development: this is not a lint about style
 * but a write that silently loses, and there is no degraded mode worth shipping
 * where it half-works.
 */
function assertClientOwned(entry: LaneEntry, operation: string): void {
  if (entry.external) {
    throw new LaneOwnershipError(entry.key, entry.keyId, operation);
  }
}

function assertScopeClientOwned(
  entries: readonly LaneEntry[],
  operation: string,
): void {
  for (const entry of entries) {
    assertClientOwned(entry, operation);
  }
}

function setEntryCache<T>(
  state: LaneState,
  entry: LaneEntry,
  valueOrPromise: LaneValue<T>,
  controller: AbortController | undefined,
): Promise<LaneRead<T>> {
  const startedAt = Date.now();

  if (!isPromiseLike(valueOrPromise)) {
    const value = shareWithLastFulfilled(entry, valueOrPromise);
    rememberFulfilled(state, entry, startedAt, value);
    const settled = Promise.resolve<LaneRead<T>>(settledRead(entry, value));

    entry.cache = {
      // A cache installed while the key already has a live reader is adopted on
      // arrival — that reader is showing it without any further subscribe.
      adopted: entry.subscribers.size > 0,
      cancelled: false,
      controller,
      promise: cacheSlot(entry, settled),
      settlement: { at: startedAt, kind: "fulfilled" },
      startedAt,
    };

    return settled;
  }

  const cache: LanePromiseCache = {
    adopted: entry.subscribers.size > 0,
    cancelled: false,
    controller,
    promise: undefined as unknown as Promise<unknown>,
    settlement: undefined,
    startedAt,
  };

  /**
   * Where a read that produced no usable value lands — a rejection, or a
   * cancelled read whose loader resolved anyway. Both want the same thing, which
   * is why the fulfilled path routes through here rather than repeating it:
   *
   * - **Stale-on-error** when there is a last fulfilled value: keep serving it so
   *   mounted readers do not lose good data, and carry the failure alongside it
   *   in the same resolved value (`refreshError`) instead of a separate channel.
   *   Freshness keeps the original fulfillment time, so staleness policies still
   *   treat the data as old. A cancel is not a refresh failure, though — the
   *   caller asked for the stop, so it comes back with nothing beside it, or
   *   every consumer that renders `refreshError` would have to filter for an
   *   abort it requested itself.
   * - **Rejected** when there is not. Nothing else a reader could show.
   */
  const settleWithoutValue = (error: unknown): LaneRead<T> => {
    const fallback = entry.lastFulfilled;

    if (!fallback) {
      cache.settlement = { at: Date.now(), kind: "rejected" };

      // Wrapped on the way out, because this is the throw that unmounts the
      // reader: whatever it was holding — the subscription, its `invalidate` —
      // goes with it, and the error is all that reaches the boundary. A
      // published key is left alone; recovering it is not the client's to offer
      // (see `LaneReadError`).
      throw entry.external
        ? error
        : new LaneReadError(entry.key, entry.keyId, error);
    }

    cache.settlement = { at: fallback.at, kind: "fulfilled" };

    // `entry.revision` (via `settledRead`) is the fallback's: the two are
    // written together, and the fallback existing means this entry is
    // client-owned, so the field applies.
    const read = settledRead(entry, fallback.value as T);

    if (!cache.cancelled) {
      read.refreshError = error;
    }

    return read;
  };

  const guarded: Promise<LaneRead<T>> = valueOrPromise.then(
    (value) => {
      if (entry.cache !== cache) {
        // Displaced before settling: this value never became the entry's
        // content, so it carries a revision of its own rather than the entry's
        // — one number must never name two different values, and reading
        // `entry.revision` here would pair this value with whatever settled
        // *after* it. The external wait resolved by its own publication lands
        // here too (the publication is what displaced it): its reader sees the
        // published value under a number of its own, which external revisions
        // permit — they only ever promise "same number ⇒ same value" — and the
        // reveal reconciliation converges it onto the store's promise anyway.
        return settledRead(entry, value, ++state.revisionCounter);
      }

      // Cancelled mid-flight. A loader that never forwarded its `signal` still
      // resolves, and adopting that value would silently undo the cancel, so the
      // read settles where it would have settled had the abort landed.
      if (cache.cancelled) {
        return settleWithoutValue(CANCELLED);
      }

      const at = Date.now();
      const shared = shareWithLastFulfilled(entry, value);

      cache.settlement = { at, kind: "fulfilled" };
      rememberFulfilled(state, entry, at, shared);

      return settledRead(entry, shared);
    },
    (error: unknown) => {
      if (entry.cache !== cache) {
        throw error;
      }

      return settleWithoutValue(error);
    },
  );

  // Bookkeeping must not surface as an unhandled rejection when no reader
  // ever consumes a rejected cache.
  guarded.catch(noop);
  cache.promise = cacheSlot(entry, guarded);
  entry.cache = cache;

  return guarded;
}

/**
 * How this entry holds the read it just installed. Strong for a client-owned
 * entry — the lane promised to keep it for `gcTime` and is the one that will
 * drop it. Weak for an external one, which is the whole retention design: the
 * publisher tethers what it published, a committed reader holds what it is
 * showing, and a value no longer reachable from either is one the owner would
 * have to re-supply anyway. Delegating to reachability is also what sidesteps
 * the thing effects cannot tell apart — a hidden subtree and an unmounted one
 * run the same cleanup, but only one of them still holds its promise.
 */
function cacheSlot(
  entry: LaneEntry,
  promise: Promise<unknown>,
): LanePromiseCache["promise"] {
  return entry.external ? externalRef(promise) : promise;
}

/** A weakly held read: alive, or collected and so indistinguishable from absent. */
type LaneWeakSlot = { deref(): Promise<unknown> | undefined };

type LaneWeakSlotFactory = (promise: Promise<unknown>) => LaneWeakSlot;

const weakSlot: LaneWeakSlotFactory = (promise) => new WeakRef(promise);

let externalRef: LaneWeakSlotFactory = weakSlot;

/**
 * Replace how external entries hold their values, or restore the default
 * (`WeakRef`) with `undefined`. Test seam, deliberately not exported from the
 * package: collection is not schedulable, but "the value is gone" is a state the
 * store must serve correctly, so a test installs a reference it can kill on
 * demand and asserts that a dead value reads as absent.
 */
export function setExternalRefFactory(
  factory: LaneWeakSlotFactory | undefined,
): void {
  externalRef = factory ?? weakSlot;
}

/**
 * The cached read, whichever way this entry holds it. The entry decides, not the
 * slot: a client-owned one is the promise, and only an external one has to be
 * asked whether its value is still there.
 */
function cachedPromise(
  entry: LaneEntry,
  cache: LanePromiseCache,
): Promise<unknown> | undefined {
  return entry.external
    ? (cache.promise as { deref(): Promise<unknown> | undefined }).deref()
    : (cache.promise as Promise<unknown>);
}

/**
 * Record a fulfilled value as the entry's last — except on an external entry,
 * where it would be a strong reference to the very value the weak one exists to
 * release. Nothing is lost with it: `lastFulfilled` feeds the stale-on-error
 * fallback, the loader's `current`, and structural sharing across reloads, and
 * all three belong to a loader that fetches. An external entry has none.
 *
 * This is also where the entry's revision advances — at the settlement, in the
 * same synchronous run that seals the resolved value, so the number and the
 * data can never pair up wrong. For a client-owned entry the two records must
 * agree: `revision` names the content `lastFulfilled` holds, so they are
 * written in the same breath, and whether the content *changed* is not
 * re-decided here — structural sharing already collapsed a deep-equal refetch
 * onto the previous reference, so a new reference is the store's own verdict
 * that this is new content. (`Object.is`, not `!==`: a value that is literally
 * `NaN` must not read as forever-changing.)
 *
 * An external entry keeps no `lastFulfilled` (a strong reference the weak
 * retention forbids), so there is nothing to compare a publication against —
 * "unchanged" is not a fact this entry can establish. Every publication
 * therefore mints: an external revision is the identity of the *publication*,
 * the client's honest "possibly new content". The safe direction — same
 * revision ⇒ same content — still holds; what is given up is only that a
 * republish of identical content reads as new. An owner with a real content
 * version ships it in the payload.
 */
function rememberFulfilled(
  state: LaneState,
  entry: LaneEntry,
  at: number,
  value: unknown,
): void {
  if (entry.external) {
    entry.revision = ++state.revisionCounter;
    return;
  }

  if (
    entry.lastFulfilled === undefined ||
    !Object.is(entry.lastFulfilled.value, value)
  ) {
    entry.revision = ++state.revisionCounter;
  }

  entry.lastFulfilled = { at, value };
}

/**
 * The resolved shape a fulfillment hands its readers: the data under the
 * revision that names it — the entry's, unless the caller mints one of its own
 * (the displaced settlement).
 */
function settledRead<T>(
  entry: LaneEntry,
  data: T,
  revision = entry.revision,
): LaneRead<T> {
  return { data, revision };
}

function shareWithLastFulfilled<T>(entry: LaneEntry, value: T): T {
  const previous = entry.lastFulfilled;

  return previous ? replaceEqualDeep(previous.value, value) : value;
}

function removeEntryCache(entry: LaneEntry): void {
  entry.cache?.controller?.abort();
  entry.cache = undefined;
}

/**
 * One coalesced GC timer per lane. Armed only when an entry loses its last
 * subscriber — the moment it becomes collectible. A single interval then sweeps
 * the whole lane and evicts every entry idle longer than `gcTime`, stopping
 * itself once nothing is idle. Being lane-wide, the same sweep also reclaims
 * orphans (entries read but never subscribed, e.g. an abandoned render) on
 * whatever cycle a real unsubscribe next triggers — so the read path never arms
 * a timer. Eviction timing is intentionally approximate; a late collection only
 * keeps a value reusable a little longer, which is harmless. `gcTime: Infinity`
 * opts out entirely.
 */
function ensureSweep(state: LaneState): void {
  // Infinity (or NaN) opts out of collection entirely.
  if (!Number.isFinite(state.gcTime)) {
    return;
  }

  // Non-positive gcTime means "collect as soon as idle": sweep once now rather
  // than arming a 0ms interval that would spin the event loop.
  if (state.gcTime <= 0) {
    sweep(state);
    return;
  }

  if (state.sweepTimer !== undefined) {
    return;
  }

  const timer = setInterval(() => sweep(state), state.gcTime);
  state.sweepTimer = timer;
  unrefTimer(timer);
}

function sweep(state: LaneState): void {
  const now = Date.now();
  let idleRemaining = false;

  for (const entry of [...state.entries.values()]) {
    // External entries are not the lane's to collect — their value lives as long
    // as the publisher's payload or a committed reader keeps it reachable, and
    // an idle timer would only race that. They are skipped rather than marked
    // idle, so they never hold the sweep open either.
    if (
      entry.external ||
      entry.subscribers.size > 0 ||
      entry.idleSince === undefined
    ) {
      continue;
    }

    if (now - entry.idleSince >= state.gcTime) {
      evictEntry(state, entry);
    } else {
      idleRemaining = true;
    }
  }

  if (!idleRemaining && state.sweepTimer !== undefined) {
    clearInterval(state.sweepTimer);
    state.sweepTimer = undefined;
  }
}

function evictEntry(state: LaneState, entry: LaneEntry): void {
  removeEntryCache(entry);
  state.entries.delete(entry.keyId);
}

/**
 * Public invalidations converge through a transition by default; `background:
 * true` routes them through the background transition instead (for automatic
 * refreshes like a self-scheduled poll, so they don't surface as
 * `isInvalidationPending`). Polling itself is not a core feature — schedule your
 * own timer and call `invalidate(key, { background: true, onlyIf: "settled" })`.
 */
export function invalidationSource(
  options?: LaneInvalidateOptions,
): LaneInvalidationSource {
  return options?.background ? "background" : "transition";
}

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof (timer as { unref: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}

function shouldInvalidateEntry(
  entry: LaneEntry,
  options: LaneInvalidateOptions,
): boolean {
  if (!options.onlyIf) {
    return true;
  }

  const cache = entry.cache;

  if (!cache?.settlement) {
    return false;
  }

  if (options.onlyIf === "settled") {
    return true;
  }

  // Exactly the entries whose readers are in an error boundary. Stale-on-error
  // records its settlement as the fallback's — `fulfilled` — so a key still
  // serving data is not one of these however its last load went, and an
  // in-flight read was already excluded above. So "retry what is broken" cannot
  // reach anything a reader is showing.
  if (options.onlyIf === "rejected") {
    return cache.settlement.kind === "rejected";
  }

  if (cache.settlement.kind === "rejected") {
    return false;
  }

  return isStale(cache, options.staleTime);
}

/**
 * `staleTime`'s default, and the one place it lives — every staleness decision
 * goes through `isStale`.
 *
 * Nothing is stale until an app says what stale means. Lane's revalidation
 * triggers are all off by default, so "how long a value stays fresh" has nothing
 * to answer to until one is turned on — and `staleTime` doubles as the rate limit
 * on the trigger it gates, so a `0` default would ship every app the version with
 * no limit. It also stacks badly with the read/trigger split: a read runs during
 * render and the trigger fires from an effect, so under a `0` default a mount
 * refetches the value that same mount just loaded.
 *
 * `Infinity` inverts both: the limit is on unless an app removes it, and
 * `staleTime: 0` is how you ask for "always stale" and take responsibility for it.
 */
const DEFAULT_STALE_TIME = Number.POSITIVE_INFINITY;

const warned = new Set<string>();

/**
 * Warns once per message.
 *
 * It exists because the `Infinity` default turns a missing `staleTime` into
 * silence rather than waste: the option is accepted, and then nothing happens.
 * That is the failure mode worth a word at the moment it is configured.
 *
 * Every call site guards with the literal
 * `typeof process !== "undefined" && process.env.NODE_ENV !== "production"`,
 * written out rather than factored into a helper or a module constant. That exact
 * expression is what bundlers substitute (and what esbuild folds on its own when
 * minifying), so the branch is dropped, this function is left unreferenced, and
 * the whole thing tree-shakes out of a production build. A `?.` on `process.env`,
 * or hiding the check behind an imported boolean, defeats the substitution and
 * ships the strings.
 */
export function warnDev(message: string): void {
  if (warned.has(message)) {
    return;
  }

  warned.add(message);
  console.warn(`[lane] ${message}`);
}

function isStale(
  cache: LanePromiseCache,
  staleTime: number | undefined,
): boolean {
  if (cache.settlement?.kind !== "fulfilled") {
    return false;
  }

  // `at` is a past timestamp, so `now - at >= 0`: any staleTime <= 0 is stale,
  // and the `Infinity` default is never stale.
  return Date.now() - cache.settlement.at >= (staleTime ?? DEFAULT_STALE_TIME);
}

function isPromiseLike<T>(value: LaneValue<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}
