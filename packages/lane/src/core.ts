import { isPrefixKey, serializeKey } from "./keys";
import { replaceEqualDeep } from "./structural";
import type {
  Lane,
  LaneEntryInfo,
  LaneHydrationSnapshots,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneOptions,
  LanePrefetchOptions,
  LaneRead,
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
};

type LaneSubscription = (
  entry: LaneEntryInfo,
  source: LaneInvalidationSource,
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
  // Whether the entry has ever had a live subscriber (a reader that committed).
  // Never-subscribed entries look identical to an idle remount — settled cache,
  // zero subscribers — but a pre-commit suspense retry is not a remount. This
  // flag lets `whenStale: "refetch"` fire only on a genuine remount of
  // previously-live data instead of looping on the retry of a first mount.
  everSubscribed: boolean;
  // Set by `invalidate(..., { after })`: new reads chain behind it instead of
  // starting immediately, so an invalidation can be announced at the start of a
  // mutation while the actual fetch waits for it to finish. Always a
  // settle-only promise (never rejects) and cleared once it settles.
  gate: Promise<void> | undefined;
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
    prefetch<T>(
      key: LaneKey,
      loader: LaneLoader<T>,
      options: LanePrefetchOptions = {},
    ) {
      // Warm the cache without subscribing or suspending: start the load and
      // hand back the promise for a later reader to adopt. Pin "revalidate" so a
      // re-fired prefetch (e.g. repeated link hover) dedupes onto the in-flight
      // or settled cache instead of refetching. Like any read it arms no GC
      // timer — an unadopted prefetch is an orphan, reclaimed by the lane-wide
      // sweep on whatever cycle a later unsubscribe triggers.
      return readOrCreate<T>(lane, key, loader, {
        retry: options.retry,
        retryDelay: options.retryDelay,
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

      return updateEntry(state, entry, updater);
    },
    updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>) {
      return matchingEntries(state.entries, scope).flatMap((entry) => {
        const promise = updateEntry(state, entry, updater);
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

export function readOrCreate<T>(
  lane: Lane,
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneReadOptions,
): Promise<LaneRead<T>> {
  const state = getLaneState(lane);
  const keyId = serializeKey(key);
  const entry = getOrCreateEntry(state, key, keyId);

  const reusable = reuseCache(entry, options);

  if (reusable) {
    return reusable.promise as Promise<LaneRead<T>>;
  }

  const controller = new AbortController();
  const load = () => runLoader(loader, key, controller.signal, options);
  // `invalidate(..., { after })` arms a gate; the load then chains behind it
  // instead of starting now. Either way the promise goes through
  // `setEntryCache`, so a gated read is just an in-flight read that has not
  // begun — readers see it as pending and keep their last value on screen. A
  // read superseded while it waits is already inert: `setEntryCache` drops any
  // result whose cache is no longer the entry's.
  const gate = entry.gate;

  return setEntryCache(
    state,
    entry,
    gate ? gate.then(load) : load(),
    controller,
  );
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
 * from active readers), or a fulfilled value the entry has never had a
 * subscriber for — that last case is a pre-commit suspense retry (or a first
 * adoption of a prefetched/hydrated value), not a remount, and discarding it
 * would loop forever: React re-reads on each retry, re-judges the just-settled
 * value stale, and refetches without ever committing. So a stale fulfilled
 * value is only discarded on a genuine idle remount of previously-live data.
 * A prior error is always retried (it throws to an error boundary rather than
 * suspending, so it cannot drive that loop).
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
  // remount; reuse so it can't loop. Only a real remount (everSubscribed)
  // refetches a stale value.
  if (!entry.everSubscribed) {
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
  entry.everSubscribed = true; // adopted: future idle reads are true remounts

  return () => {
    entry.subscribers.delete(subscriber);

    if (entry.subscribers.size > 0) {
      return;
    }

    if (!entry.cache && !entry.gate) {
      // No cache, no gate, no subscribers: nothing worth keeping, drop now.
      if (state.entries.get(entry.keyId) === entry) {
        state.entries.delete(entry.keyId);
      }

      return;
    }

    // Idle with a cache (or an armed gate): retained for reuse, collected by the
    // central sweep once it has been idle for the lane's gcTime.
    entry.idleSince = Date.now();
    ensureSweep(state);
  };
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

  removeEntryCache(entry);

  // Armed before the notification, so the re-read it triggers already chains
  // behind the gate. Settlement is all that is observed — a rejected action
  // still lets the read run, because `after` chooses *when* to converge, not
  // whether the key is suspect; swallowing it here also keeps a caller-owned
  // failure from surfacing as an unhandled rejection through Lane.
  if (options.after) {
    const gate = options.after.then(noop, noop);

    entry.gate = gate;
    void gate.then(() => {
      if (entry.gate === gate) {
        entry.gate = undefined;
      }
    });
  }

  notifyInvalidate(entry, source);
  cleanupEntry(state, entry);
}

function removeLaneEntry(state: LaneState, entry: LaneEntry): void {
  removeEntryCache(entry);
  notifyRemove(entry);
  cleanupEntry(state, entry);
}

function updateEntry<T>(
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
  // An armed gate keeps the entry alive even with nothing to show and no one
  // reading: dropping it would let a reader that arrives mid-action create a
  // fresh, ungated entry and fetch straight into the pre-mutation source.
  if (entry.cache || entry.gate || entry.subscribers.size > 0) {
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

function runLoader<T>(
  loader: LaneLoader<T>,
  key: LaneKey,
  signal: AbortSignal,
  options: LaneReadOptions | undefined,
): Promise<T> {
  const retry = options?.retry ?? 0;
  const retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;
  let attempt = 0;

  const attemptLoad = (): Promise<T> =>
    Promise.resolve()
      .then(() => loader({ key, signal }))
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
    everSubscribed: false,
    gate: undefined,
    idleSince: Date.now(), // born idle: reclaimable as an orphan by a later sweep
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
      controller,
      promise: Promise.resolve<LaneRead<T>>({ data: value }),
      settlement: { at: startedAt, kind: "fulfilled" },
      startedAt,
    };
    entry.lastFulfilled = { at: startedAt, value };

    return entry.cache.promise as Promise<LaneRead<T>>;
  }

  const cache: LanePromiseCache = {
    controller,
    promise: undefined as unknown as Promise<unknown>,
    settlement: undefined,
    startedAt,
  };

  const guarded: Promise<LaneRead<T>> = valueOrPromise.then(
    (value) => {
      if (entry.cache !== cache) {
        return { data: value };
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

      const fallback = entry.lastFulfilled;

      if (!fallback) {
        cache.settlement = { at: Date.now(), kind: "rejected" };
        throw error;
      }

      // Stale-on-error: keep serving the last fulfilled value so mounted readers
      // do not lose good data, and carry the failure alongside it in the same
      // resolved value (`refreshError`) instead of a separate channel. Freshness
      // keeps the original fulfillment time, so staleness policies still treat
      // the data as old.
      cache.settlement = { at: fallback.at, kind: "fulfilled" };

      return { data: fallback.value as T, refreshError: error };
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
