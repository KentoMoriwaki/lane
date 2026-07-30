import { isPrefixKey, serializeKey } from "./keys";
import { replaceEqualDeep } from "./structural";
import type {
  Lane,
  LaneEntryInfo,
  LaneHydrationSnapshots,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneLoaderMeta,
  LaneLoaderMetaArgs,
  LaneOptions,
  LaneRead,
  LaneReadSpec,
  LaneRetryDelay,
  LaneScope,
  LaneUpdater,
  LaneValue,
  LaneWhenStale,
} from "./types";

export type LaneInvalidationSource = "background" | "transition";

export type LaneReadOptions = {
  retry?: number;
  retryDelay?: LaneRetryDelay;
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
  // Set by `invalidate(..., { after })`: the re-read this notification triggers
  // must wait for it before fetching. Pass it straight back to `readOrCreate`.
  gate: Promise<void> | undefined,
) => void;

type LaneRemoveSubscription = (entry: LaneEntryInfo) => void;

// A subscriber is a pure notify hook plus a GC anchor — it carries no policy.
// When to revalidate (focus / reconnect / mount / stale) is the reader's
// concern, expressed as per-read invalidations; the store only notifies. Even
// focus / reconnect stay out of here — they are DOM concerns the provider owns.
type LaneSubscriber = {
  onInvalidate?: LaneSubscription;
  onRemove?: LaneRemoveSubscription;
};

type LaneState = {
  entries: Map<string, LaneEntry>;
  gcTime: number;
  sweepTimer: ReturnType<typeof setInterval> | undefined;
};

type LanePromiseSettlement = {
  at: number;
  kind: "fulfilled" | "rejected";
};

type LanePromiseCache = {
  promise: Promise<unknown>;
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
  // The source of the most recent notification for this key. A reader that
  // subscribes after one has already gone out has no notification to read the
  // source from, so it reads it here and converges through the matching
  // transition — otherwise siblings of one key disagree about which pending flag
  // is set for the same update.
  lastNotifySource: LaneInvalidationSource | undefined;
};

export const DEFAULT_GC_TIME = 5 * 60_000;

const DEFAULT_RETRY_DELAY: LaneRetryDelay = (attempt) =>
  Math.min(1_000 * 2 ** attempt, 30_000);

const laneStates = new WeakMap<Lane, LaneState>();

export function createLane(options: LaneOptions = {}): Lane {
  const state: LaneState = {
    entries: new Map(),
    gcTime: options.gcTime ?? DEFAULT_GC_TIME,
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
      return readOrCreate<T, C>(lane, read.key, read.loader, {
        // Same precedence as a hook read: the read's own override wins over the
        // value supplied alongside it.
        loaderMeta: read.loaderMeta ?? args[0]?.loaderMeta,
        retry: read.retry,
        retryDelay: read.retryDelay,
        whenStale: "revalidate",
      });
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
      const keyId = serializeKey(key);
      const entry = getOrCreateEntry(state, key, keyId);
      const promise = publishEntryValue(state, entry, valueOrPromise);

      notifyInvalidate(entry, "transition");

      return promise;
    },
    update<T>(key: LaneKey, updater: LaneUpdater<T>) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return undefined;
      }

      return updateLaneEntry(state, entry, updater);
    },
    updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>) {
      return matchingEntries(state.entries, scope).flatMap((entry) => {
        const promise = updateLaneEntry(state, entry, updater);
        return promise ? [promise] : [];
      });
    },
    remove(key) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      removeLaneEntry(state, entry);
    },
    removeAll(scope) {
      for (const entry of matchingEntries(state.entries, scope)) {
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
 * Applies server snapshots as authoritative values. Existing entries are
 * overwritten and their subscribers notified so that mounted readers converge
 * to the new data when a navigation re-hydrates the same keys.
 */
export function hydrateMany(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): void {
  const state = getLaneState(lane);

  for (const snapshot of snapshots.entries) {
    const keyId = serializeKey(snapshot.key);
    const entry = getOrCreateEntry(state, snapshot.key, keyId);

    publishEntryValue(state, entry, snapshot.data);
    notifyInvalidate(entry, "transition");
  }
}

export function readOrCreate<T, C = T>(
  lane: Lane,
  key: LaneKey,
  loader: LaneLoader<T, C>,
  options?: LaneReadOptions,
  gate?: Promise<void>,
): Promise<LaneRead<T>> {
  const state = getLaneState(lane);
  const keyId = serializeKey(key);
  const entry = getOrCreateEntry(state, key, keyId);

  const reusable = reuseCache(entry, options);

  if (reusable) {
    return reusable.promise as Promise<LaneRead<T>>;
  }

  const controller = new AbortController();
  // Snapshot the last fulfilled value now, so every retry of this read sees the
  // same `current` and a value published while the read is in flight cannot
  // change what it was started from. It outlives invalidation (which clears the
  // cache, not `lastFulfilled`) and is `undefined` once the entry itself is
  // gone.
  const current = entry.lastFulfilled?.value as C | undefined;
  const load = () => runLoader(loader, key, controller.signal, options, current);
  // A gated read is an in-flight read that has not begun: readers see it as
  // pending and hold their last value on screen until the action lands.
  const promise = gate ? gate.then(load) : load();

  return setEntryCache(state, entry, promise, controller);
}

/**
 * Whether a read reuses the cached promise.
 *
 * `"revalidate"` (default) always reuses an existing cache — staleness is
 * refreshed separately in the background, so a reader shows the cached value
 * and converges through a transition (the long-standing behavior).
 *
 * `"refetch"` discards a stale value (or a prior error) and suspends on a fresh
 * read, but never discards an in-flight read (would break same-transition
 * sharing), a value a live subscriber is showing (would yank a shared promise
 * from active readers), or a fulfilled value *no reader has committed on* — that
 * last case is a pre-commit suspense retry (or a first adoption of a
 * prefetched/hydrated value), not a remount, and discarding it would loop
 * forever: React re-reads on each retry, re-judges the just-settled value stale,
 * and refetches without ever committing. So a stale fulfilled value is only
 * discarded on a genuine idle remount of previously-live data.
 * A prior error is always retried (it throws to an error boundary rather than
 * suspending, so it cannot drive that loop).
 *
 * Adoption is tracked per *cache*, not per entry. An entry-wide "has ever been
 * subscribed" flag looks equivalent and is not: it stays true once the key has
 * been mounted at all, so the retry after a remount's *own* refetch is judged a
 * remount too — and the loop this guard exists to prevent reappears on the
 * second visit to any key.
 */
function reuseCache(
  entry: LaneEntry,
  options: LaneReadOptions | undefined,
): LanePromiseCache | undefined {
  const cache = entry.cache;

  if (!cache) {
    return undefined;
  }

  if ((options?.whenStale ?? "revalidate") !== "refetch") {
    return cache;
  }

  if (cache.settlement === undefined || entry.subscribers.size > 0) {
    return cache;
  }

  // Errors are checked before the mount gate: a rejected read throws to an error
  // boundary instead of suspending, so it never drives the loop, and a boundary
  // reset must be able to retry it even though the read never committed.
  if (cache.settlement.kind === "rejected") {
    return undefined;
  }

  // Never adopted → a pre-commit retry or a first prefetch/hydration read, not a
  // remount; reuse so it can't loop. Only a value some reader actually committed
  // on is stale enough to throw away.
  if (!cache.adopted) {
    return cache;
  }

  return isStale(cache, options?.staleTime ?? 0) ? undefined : cache;
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

  return updateLaneEntry(state, entry, updater);
}

export function subscribeLane(
  lane: Lane,
  key: LaneKey,
  subscriber: LaneSubscriber,
): () => void {
  const state = getLaneState(lane);
  const keyId = serializeKey(key);
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
 * The source of the last notification for a key, for a reader catching up on one
 * it was not subscribed in time to receive. `undefined` when the key has never
 * been notified — or no longer exists — in which case the reader has no reason
 * to treat its catch-up as user-driven.
 */
export function latestNotifySource(
  lane: Lane,
  keyId: string,
): LaneInvalidationSource | undefined {
  return getLaneState(lane).entries.get(keyId)?.lastNotifySource;
}

export function onInvalidate(
  lane: Lane,
  key: LaneKey,
  listener: LaneSubscription,
): () => void {
  return subscribeLane(lane, key, { onInvalidate: listener });
}

export function onRemove(
  lane: Lane,
  key: LaneKey,
  listener: LaneRemoveSubscription,
): () => void {
  return subscribeLane(lane, key, { onRemove: listener });
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

  // `{ after }` rides the notification: subscribers re-read synchronously during
  // the fan-out, the first one installs a cache whose load waits for the gate,
  // and the rest dedupe onto it. The gate only has to outlive the fan-out, so it
  // is an argument rather than state. Settlement is all that is observed — a
  // rejected action still invalidates, because `after` chooses *when* to
  // converge rather than whether the key is suspect, and swallowing it keeps a
  // caller-owned failure from surfacing through Lane.
  const gate = options.after?.then(noop, noop);

  if (gate && entry.subscribers.size === 0) {
    // Nobody to announce it to, and nobody to refill the cache the fan-out would
    // empty — so emptying it would leave a reader arriving mid-action fetching
    // straight into the pre-mutation source. Leave the entry intact and converge
    // when the action lands, which is what `await action; invalidate(key)` does.
    // Resolved by key, so an action outliving its entry still converges whatever
    // occupies the slot.
    void gate.then(() => {
      const current = state.entries.get(entry.keyId);

      if (current) {
        invalidateLaneEntry(state, current, {}, source);
      }
    });

    return;
  }

  removeEntryCache(entry);
  notifyInvalidate(entry, source, gate);
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

  if (!cache || cache.settlement?.kind === "rejected") {
    return undefined;
  }

  const info = { key: entry.key, keyId: entry.keyId };
  const valueOrPromise = cache.promise.then((current) =>
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
  entry.cache?.controller?.abort();

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
  gate?: Promise<void>,
): void {
  const info = entryInfo(entry);

  entry.lastNotifySource = source;

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onInvalidate?.(info, source, gate);
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
  const retry = options?.retry ?? 0;
  const retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;
  // Snapshotted with the read, like `current`: every retry below sees the value
  // the read started with, not whatever the provider holds when the retry fires.
  const meta = options?.loaderMeta as LaneLoaderMeta;
  let attempt = 0;

  const attemptLoad = (): Promise<T> =>
    Promise.resolve()
      .then(() => loader({ current, key, meta, signal }))
      .catch((error: unknown) => {
        if (signal.aborted || attempt >= retry) {
          throw error;
        }

        const delay = retryDelay(attempt, error);
        attempt += 1;

        return sleep(delay, signal).then(() => {
          if (signal.aborted) {
            throw error;
          }

          return attemptLoad();
        });
      });

  return attemptLoad();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(finish, ms);

    function finish(): void {
      signal.removeEventListener("abort", finish);
      clearTimeout(timer);
      resolve();
    }

    signal.addEventListener("abort", finish);
  });
}

function createEntry(
  key: LaneKey,
  keyId: string,
): LaneEntry {
  return {
    cache: undefined,
    idleSince: Date.now(), // born idle: reclaimable as an orphan by a later sweep
    lastNotifySource: undefined,
    key,
    keyId,
    lastFulfilled: undefined,
    subscribers: new Set(),
  };
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

    entry.cache = {
      // A cache installed while the key already has a live reader is adopted on
      // arrival — that reader is showing it without any further subscribe.
      adopted: entry.subscribers.size > 0,
      cancelled: false,
      controller,
      promise: Promise.resolve<LaneRead<T>>({ data: value }),
      settlement: { at: startedAt, kind: "fulfilled" },
      startedAt,
    };
    entry.lastFulfilled = { at: startedAt, value };

    return entry.cache.promise as Promise<LaneRead<T>>;
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
      throw error;
    }

    cache.settlement = { at: fallback.at, kind: "fulfilled" };

    return cache.cancelled
      ? { data: fallback.value as T }
      : { data: fallback.value as T, refreshError: error };
  };

  const guarded: Promise<LaneRead<T>> = valueOrPromise.then(
    (value) => {
      if (entry.cache !== cache) {
        return { data: value };
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
      entry.lastFulfilled = { at, value: shared };

      return { data: shared };
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
  cache.promise = guarded;
  entry.cache = cache;

  return guarded;
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
    if (entry.subscribers.size > 0 || entry.idleSince === undefined) {
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
 * `isTransitionPending`). Polling itself is not a core feature — schedule your
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

  if (cache.settlement.kind === "rejected") {
    return false;
  }

  return isStale(cache, options.staleTime ?? 0);
}

function isStale(cache: LanePromiseCache, staleTime: number): boolean {
  if (cache.settlement?.kind !== "fulfilled") {
    return false;
  }

  // `at` is a past timestamp, so `now - at >= 0`: any staleTime <= 0 is stale.
  return Date.now() - cache.settlement.at >= staleTime;
}

function isPromiseLike<T>(value: LaneValue<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}
