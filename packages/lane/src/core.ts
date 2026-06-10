import { isPrefixKey, serializeKey } from "./keys";
import type {
  Lane,
  LaneEntryInfo,
  LaneHydrationSnapshots,
  LaneInvalidateOptions,
  LaneKey,
  LaneScope,
  LaneUpdater,
  LaneUseOptions,
  LaneValue,
} from "./types";

export type LaneInvalidationSource = "background" | "transition";

type LaneSubscription = (
  entry: LaneEntryInfo,
  source: LaneInvalidationSource,
) => void;

type LaneRemoveSubscription = (entry: LaneEntryInfo) => void;

type LaneSubscriber = {
  onInvalidate?: LaneSubscription;
  onRemove?: LaneRemoveSubscription;
  options: Pick<LaneUseOptions, "refetchOnFocus" | "staleTime">;
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
};

type LaneEntry = {
  key: LaneKey;
  keyId: string;
  cache: LanePromiseCache | undefined;
  subscribers: Set<LaneSubscriber>;
};

const laneStates = new WeakMap<Lane, LaneState>();

export function createLane(): Lane {
  const state: LaneState = {
    entries: new Map(),
  };

  function invalidate(
    key: LaneKey,
    options: LaneInvalidateOptions = {},
  ): void {
    const keyId = serializeKey(key);
    const entry = state.entries.get(keyId);

    if (!entry) {
      return;
    }

    invalidateLaneEntry(entry, options);
  }

  function invalidateAll(
    scope: LaneScope,
    options: LaneInvalidateOptions = {},
  ): void {
    for (const entry of matchingEntries(state.entries, scope)) {
      invalidateLaneEntry(entry, options);
    }
  }

  function set<T>(
    key: LaneKey,
    valueOrPromise: LaneValue<T>,
  ): Promise<T> {
    const keyId = serializeKey(key);
    const entry = getOrCreateEntry(state, key, keyId);
    const promise = setEntryCache(entry, valueOrPromise);

    notifyInvalidate(entry, "transition");

    return promise;
  }

  function update<T>(
    key: LaneKey,
    updater: LaneUpdater<T>,
  ): Promise<T> | undefined {
    const keyId = serializeKey(key);
    const entry = state.entries.get(keyId);

    if (!entry) {
      return undefined;
    }

    return updateEntry(entry, updater);
  }

  function updateAll<T>(
    scope: LaneScope,
    updater: LaneUpdater<T>,
  ): Promise<T>[] {
    return matchingEntries(state.entries, scope).flatMap((entry) => {
      const promise = updateEntry(entry, updater);
      return promise ? [promise] : [];
    });
  }

  function remove(key: LaneKey): void {
    const keyId = serializeKey(key);
    const entry = state.entries.get(keyId);

    if (!entry) {
      return;
    }

    removeEntryCache(entry);
    notifyRemove(entry);
    cleanupEntry(entry);
  }

  function removeAll(scope: LaneScope): void {
    for (const entry of matchingEntries(state.entries, scope)) {
      removeEntryCache(entry);
      notifyRemove(entry);
      cleanupEntry(entry);
    }
  }

  const lane: Lane = {
    invalidate,
    invalidateAll,
    remove,
    removeAll,
    set,
    update,
    updateAll,
  };

  laneStates.set(lane, state);

  return lane;

  function updateEntry<T>(
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
    const updated = setEntryCache(entry, valueOrPromise);

    notifyInvalidate(entry, "transition");

    return updated as Promise<T>;
  }

  function invalidateLaneEntry(
    entry: LaneEntry,
    options: LaneInvalidateOptions,
  ): void {
    if (!shouldInvalidateEntry(entry, options)) {
      return;
    }

    removeEntryCache(entry);
    notifyInvalidate(entry, "transition");
    cleanupEntry(entry);
  }

  function cleanupEntry(entry: LaneEntry): void {
    if (entry.cache || entry.subscribers.size > 0) {
      return;
    }

    state.entries.delete(entry.keyId);
  }
}

export function hydrateMany(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): void {
  const state = getLaneState(lane);

  for (const snapshot of snapshots.entries) {
    const keyId = serializeKey(snapshot.key);
    const entry = getOrCreateEntry(state, snapshot.key, keyId);

    setEntryCache(entry, snapshot.data);
  }
}

export function readOrCreate<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
): Promise<T> {
  const state = getLaneState(lane);
  const keyId = serializeKey(key);
  const entry = getOrCreateEntry(state, key, keyId);

  if (entry.cache) {
    return entry.cache.promise as Promise<T>;
  }

  return setEntryCache(entry, createLoaderPromise(loader));
}

export function invalidateEntry(
  lane: Lane,
  keyId: string,
  options: LaneInvalidateOptions = {},
  source: LaneInvalidationSource = "transition",
): void {
  const entry = getExistingEntry(lane, keyId);

  if (!entry) {
    return;
  }

  if (!shouldInvalidateEntry(entry, options)) {
    return;
  }

  removeEntryCache(entry);
  notifyInvalidate(entry, source);
  cleanupExistingEntry(lane, entry);
}

export function refetchOnFocus(lane: Lane): void {
  const state = getLaneState(lane);

  for (const entry of [...state.entries.values()]) {
    const options = invalidateOptionsForFocus(entry);

    if (!options) {
      continue;
    }

    if (!shouldInvalidateEntry(entry, options)) {
      continue;
    }

    removeEntryCache(entry);
    notifyInvalidate(entry, "background");
    cleanupExistingEntry(lane, entry);
  }
}

export function subscribeLane(
  lane: Lane,
  keyId: string,
  subscriber: LaneSubscriber,
): () => void {
  const entry = getExistingEntry(lane, keyId);

  if (!entry) {
    return noop;
  }

  return subscribe(entry.subscribers, subscriber, () =>
    cleanupExistingEntry(lane, entry),
  );
}

export function onInvalidate(
  lane: Lane,
  keyId: string,
  listener: LaneSubscription,
): () => void {
  return subscribeLane(lane, keyId, {
    onInvalidate: listener,
    options: {},
  });
}

export function onRemove(
  lane: Lane,
  keyId: string,
  listener: LaneRemoveSubscription,
): () => void {
  return subscribeLane(lane, keyId, {
    onRemove: listener,
    options: {},
  });
}

function subscribe(
  subscribers: Set<LaneSubscriber>,
  subscriber: LaneSubscriber,
  cleanup: () => void,
): () => void {
  subscribers.add(subscriber);

  return () => {
    subscribers.delete(subscriber);
    cleanup();
  };
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

function getExistingEntry(lane: Lane, keyId: string): LaneEntry | undefined {
  return getLaneState(lane).entries.get(keyId);
}

function cleanupExistingEntry(lane: Lane, entry: LaneEntry): void {
  const state = getLaneState(lane);

  if (entry.cache || entry.subscribers.size > 0) {
    return;
  }

  state.entries.delete(entry.keyId);
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

function normalizePromise<T>(valueOrPromise: LaneValue<T>): Promise<T> {
  return Promise.resolve(valueOrPromise);
}

function createLoaderPromise<T>(loader: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(loader);
}

function createEntry(
  key: LaneKey,
  keyId: string,
): LaneEntry {
  return {
    cache: undefined,
    key,
    keyId,
    subscribers: new Set(),
  };
}

function setEntryCache<T>(
  entry: LaneEntry,
  valueOrPromise: LaneValue<T>,
): Promise<T> {
  const promise = normalizePromise(valueOrPromise);
  const startedAt = Date.now();
  const cache: LanePromiseCache = {
    promise,
    settlement: undefined,
    startedAt,
  };

  entry.cache = cache;

  if (!isPromiseLike(valueOrPromise)) {
    cache.settlement = { at: startedAt, kind: "fulfilled" };
    return promise;
  }

  promise.then(
    () => {
      if (entry.cache !== cache) {
        return;
      }

      cache.settlement = { at: Date.now(), kind: "fulfilled" };
    },
    () => {
      if (entry.cache !== cache) {
        return;
      }

      cache.settlement = { at: Date.now(), kind: "rejected" };
    },
  );

  return promise;
}

function removeEntryCache(entry: LaneEntry): void {
  entry.cache = undefined;
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
