import { isPrefixKey, serializeKey } from "./keys";
import { replaceEqualDeep } from "./structural";
import type {
  Lane,
  LaneEntryInfo,
  LaneHydrationSnapshots,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneRetryDelay,
  LaneScope,
  LaneUpdater,
  LaneUseOptions,
  LaneValue,
} from "./types";

export type LaneInvalidationSource = "background" | "transition";

export type LaneReadOptions = {
  retry?: number;
  retryDelay?: LaneRetryDelay;
};

type LaneSubscription = (
  entry: LaneEntryInfo,
  source: LaneInvalidationSource,
) => void;

type LaneRemoveSubscription = (entry: LaneEntryInfo) => void;

type LaneSubscriber = {
  onInvalidate?: LaneSubscription;
  onRemove?: LaneRemoveSubscription;
  options: Pick<LaneUseOptions, "refetchOnFocus" | "staleTime" | "gcTime">;
};

type LaneState = {
  entries: Map<string, LaneEntry>;
};

type LanePromiseSettlement = {
  at: number;
  kind: "fulfilled" | "rejected";
};

type LanePromiseCache = {
  promise: Promise<unknown>;
  settlement: LanePromiseSettlement | undefined;
  startedAt: number;
  refreshError: { error: unknown; at: number } | undefined;
  controller: AbortController | undefined;
};

type LaneEntry = {
  key: LaneKey;
  keyId: string;
  cache: LanePromiseCache | undefined;
  subscribers: Set<LaneSubscriber>;
  lastFulfilled: { value: unknown; at: number } | undefined;
  gcTime: number | undefined;
  gcTimer: ReturnType<typeof setTimeout> | undefined;
};

export const DEFAULT_GC_TIME = 5 * 60_000;

const DEFAULT_RETRY_DELAY: LaneRetryDelay = (attempt) =>
  Math.min(1_000 * 2 ** attempt, 30_000);

const laneStates = new WeakMap<Lane, LaneState>();

export function createLane(): Lane {
  const state: LaneState = {
    entries: new Map(),
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
): Promise<T> {
  const state = getLaneState(lane);
  const keyId = serializeKey(key);
  const entry = getOrCreateEntry(state, key, keyId);

  if (entry.cache) {
    return entry.cache.promise as Promise<T>;
  }

  const controller = new AbortController();
  const promise = runLoader(loader, key, controller.signal, options);

  return setEntryCache(state, entry, promise, controller);
}

export function readRefreshError(lane: Lane, keyId: string): unknown {
  return getLaneState(lane).entries.get(keyId)?.cache?.refreshError?.error;
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
  const state = getLaneState(lane);

  for (const entry of [...state.entries.values()]) {
    const options = invalidateOptionsForFocus(entry);

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

  if (subscriber.options.gcTime !== undefined) {
    entry.gcTime = Math.max(entry.gcTime ?? 0, subscriber.options.gcTime);
  }

  disarmGc(entry);
  entry.subscribers.add(subscriber);

  return () => {
    entry.subscribers.delete(subscriber);

    if (entry.subscribers.size > 0) {
      return;
    }

    if (!entry.cache) {
      disarmGc(entry);

      if (state.entries.get(entry.keyId) === entry) {
        state.entries.delete(entry.keyId);
      }

      return;
    }

    armGc(state, entry);
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
): Promise<T> | undefined {
  const cache = entry.cache;

  if (!cache || cache.settlement?.kind === "rejected") {
    return undefined;
  }

  const info = { key: entry.key, keyId: entry.keyId };
  const valueOrPromise = cache.promise.then((current) =>
    updater(current as T, info),
  );
  // The updater adopts the in-flight result, so the previous controller must
  // stay un-aborted and keeps guarding the chained cache.
  const updated = setEntryCache(state, entry, valueOrPromise, cache.controller);

  notifyInvalidate(entry, "transition");

  return updated as Promise<T>;
}

function publishEntryValue<T>(
  state: LaneState,
  entry: LaneEntry,
  valueOrPromise: LaneValue<T>,
): Promise<T> {
  entry.cache?.controller?.abort();

  return setEntryCache(state, entry, valueOrPromise, undefined);
}

function cleanupEntry(state: LaneState, entry: LaneEntry): void {
  if (entry.cache || entry.subscribers.size > 0) {
    return;
  }

  disarmGc(entry);
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

function invalidateOptionsForFocus(
  entry: LaneEntry,
): LaneInvalidateOptions | undefined {
  let staleTime: number | undefined;
  let shouldRefetchStale = false;

  for (const subscriber of entry.subscribers) {
    const refetchOnFocus = subscriber.options.refetchOnFocus ?? false;

    if (refetchOnFocus === "always") {
      return { onlyIf: "settled" };
    }

    if (refetchOnFocus !== true) {
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
    gcTime: undefined,
    gcTimer: undefined,
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
): Promise<T> {
  const startedAt = Date.now();

  if (!isPromiseLike(valueOrPromise)) {
    const value = shareWithLastFulfilled(entry, valueOrPromise);

    entry.cache = {
      controller,
      promise: Promise.resolve(value),
      refreshError: undefined,
      settlement: { at: startedAt, kind: "fulfilled" },
      startedAt,
    };
    entry.lastFulfilled = { at: startedAt, value };
    armGcIfIdle(state, entry);

    return entry.cache.promise as Promise<T>;
  }

  const cache: LanePromiseCache = {
    controller,
    promise: undefined as unknown as Promise<unknown>,
    refreshError: undefined,
    settlement: undefined,
    startedAt,
  };

  const guarded = valueOrPromise.then(
    (value) => {
      if (entry.cache !== cache) {
        return value;
      }

      const at = Date.now();
      const shared = shareWithLastFulfilled(entry, value);

      cache.settlement = { at, kind: "fulfilled" };
      entry.lastFulfilled = { at, value: shared };

      return shared;
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

      // Stale-on-error: keep serving the last fulfilled value so mounted
      // readers do not lose good data, and surface the failure separately.
      // Freshness keeps the original fulfillment time, so staleness policies
      // still treat the data as old.
      cache.settlement = { at: fallback.at, kind: "fulfilled" };
      cache.refreshError = { at: Date.now(), error };

      return fallback.value as T;
    },
  );

  // Bookkeeping must not surface as an unhandled rejection when no reader
  // ever consumes a rejected cache.
  guarded.catch(noop);
  cache.promise = guarded;
  entry.cache = cache;
  armGcIfIdle(state, entry);

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

function armGcIfIdle(state: LaneState, entry: LaneEntry): void {
  if (entry.subscribers.size > 0) {
    return;
  }

  armGc(state, entry);
}

function armGc(state: LaneState, entry: LaneEntry): void {
  disarmGc(entry);

  const gcTime = entry.gcTime ?? DEFAULT_GC_TIME;

  if (!Number.isFinite(gcTime)) {
    return;
  }

  const timer = setTimeout(() => {
    entry.gcTimer = undefined;

    if (entry.subscribers.size > 0) {
      return;
    }

    if (state.entries.get(entry.keyId) !== entry) {
      return;
    }

    removeEntryCache(entry);
    state.entries.delete(entry.keyId);
  }, gcTime);

  entry.gcTimer = timer;
  unrefTimer(timer);
}

function disarmGc(entry: LaneEntry): void {
  if (entry.gcTimer === undefined) {
    return;
  }

  clearTimeout(entry.gcTimer);
  entry.gcTimer = undefined;
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
