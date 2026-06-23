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
  LaneRead,
  LaneRetryDelay,
  LaneScope,
  LaneUpdater,
  LaneUseOptions,
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

type LaneSubscriber = {
  onInvalidate?: LaneSubscription;
  onRemove?: LaneRemoveSubscription;
  options: Pick<
    LaneUseOptions,
    "refetchInterval" | "refetchOnFocus" | "refetchOnReconnect" | "staleTime"
  >;
};

type LaneRevalidateTrigger = boolean | "always" | undefined;

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
  pollInterval: number | undefined;
  pollTimer: ReturnType<typeof setInterval> | undefined;
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
    invalidate(key, options = {}) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      invalidateLaneEntry(state, entry, options, "transition");
    },
    invalidateAll(scope, options = {}) {
      for (const entry of matchingEntries(state.entries, scope)) {
        invalidateLaneEntry(state, entry, options, "transition");
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
  const promise = runLoader(loader, key, controller.signal, options);

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
 * sharing) or a value a live subscriber is showing (would yank a shared promise
 * from active readers) — so it only forces a fresh load on an otherwise idle
 * remount.
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

  // refetch is a deliberate read-time choice on an idle remount, not a
  // background trigger — so it does not inherit core's "rejected is never
  // stale" rule (which exists only to stop focus/poll/mount from hammering a
  // failing endpoint). Re-surfacing a prior error on remount helps no one, so
  // always retry it; a fulfilled value follows the usual staleness rule.
  if (cache.settlement.kind === "rejected") {
    return undefined;
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

export function refetchOnFocus(lane: Lane): void {
  revalidateEntries(lane, (options) => options.refetchOnFocus);
}

export function refetchOnReconnect(lane: Lane): void {
  revalidateEntries(lane, (options) => options.refetchOnReconnect);
}

function revalidateEntries(
  lane: Lane,
  pick: (options: LaneSubscriber["options"]) => LaneRevalidateTrigger,
): void {
  const state = getLaneState(lane);

  for (const entry of [...state.entries.values()]) {
    const options = invalidateOptionsForTrigger(entry, pick);

    if (!options) {
      continue;
    }

    invalidateLaneEntry(state, entry, options, "background");
  }
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
  recomputePolling(state, entry);

  return () => {
    entry.subscribers.delete(subscriber);
    recomputePolling(state, entry);

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

export function onInvalidate(
  lane: Lane,
  key: LaneKey,
  listener: LaneSubscription,
): () => void {
  return subscribeLane(lane, key, {
    onInvalidate: listener,
    options: {},
  });
}

export function onRemove(
  lane: Lane,
  key: LaneKey,
  listener: LaneRemoveSubscription,
): () => void {
  return subscribeLane(lane, key, {
    onRemove: listener,
    options: {},
  });
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
  if (entry.cache || entry.subscribers.size > 0) {
    return;
  }

  disarmPolling(entry);
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

function invalidateOptionsForTrigger(
  entry: LaneEntry,
  pick: (options: LaneSubscriber["options"]) => LaneRevalidateTrigger,
): LaneInvalidateOptions | undefined {
  let staleTime: number | undefined;
  let shouldRefetchStale = false;

  for (const subscriber of entry.subscribers) {
    const trigger = pick(subscriber.options) ?? false;

    if (trigger === "always") {
      return { onlyIf: "settled" };
    }

    if (trigger !== true) {
      continue;
    }

    shouldRefetchStale = true;
    staleTime = Math.min(
      staleTime ?? Infinity,
      subscriber.options.staleTime ?? 0,
    );
  }

  if (!shouldRefetchStale) {
    return undefined;
  }

  return { onlyIf: "stale", staleTime };
}

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
    idleSince: Date.now(), // born idle: reclaimable as an orphan by a later sweep
    key,
    keyId,
    lastFulfilled: undefined,
    pollInterval: undefined,
    pollTimer: undefined,
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
  disarmPolling(entry);
  state.entries.delete(entry.keyId);
}

/**
 * Keeps one interval timer per entry, driven by the smallest positive
 * refetchInterval across current subscribers. Ticks go through the regular
 * settled-only invalidation, so pending reads dedupe naturally and readers
 * converge through their background transition.
 */
function recomputePolling(state: LaneState, entry: LaneEntry): void {
  const interval = pollIntervalFor(entry);

  if (interval === entry.pollInterval) {
    return;
  }

  disarmPolling(entry);
  entry.pollInterval = interval;

  if (interval === undefined) {
    return;
  }

  const timer = setInterval(() => {
    invalidateLaneEntry(state, entry, { onlyIf: "settled" }, "background");
  }, interval);

  entry.pollTimer = timer;
  unrefTimer(timer);
}

function pollIntervalFor(entry: LaneEntry): number | undefined {
  let interval: number | undefined;

  for (const subscriber of entry.subscribers) {
    const candidate = subscriber.options.refetchInterval;

    if (
      candidate === undefined ||
      candidate <= 0 ||
      !Number.isFinite(candidate)
    ) {
      continue;
    }

    interval = Math.min(interval ?? Infinity, candidate);
  }

  return interval;
}

function disarmPolling(entry: LaneEntry): void {
  if (entry.pollTimer === undefined) {
    return;
  }

  clearInterval(entry.pollTimer);
  entry.pollTimer = undefined;
  entry.pollInterval = undefined;
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

  if (staleTime <= 0) {
    return true;
  }

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
