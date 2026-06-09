import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";

export type LaneKey = readonly unknown[];

export type LaneValue<T> = T | Promise<T>;

export type LaneScope =
  | LaneKey
  | ((entry: { key: LaneKey; keyId: string }) => boolean);

export type LaneEntrySeed<T = unknown> = readonly [
  key: LaneKey,
  valueOrPromise: LaneValue<T>,
];

export type LaneSubscription = () => void;

export type LaneEntryInfo = {
  key: LaneKey;
  keyId: string;
};

export type LaneUpdater<T> = (
  current: T,
  entry: LaneEntryInfo,
) => LaneValue<T>;

export type LaneInvalidateOptions = {
  onlyIf?: "stale" | "settled";
  staleTime?: number;
};

export type Lane = {
  seed<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T>;
  seedMany(entries: readonly LaneEntrySeed[]): void;
  readOrCreate<T>(key: LaneKey, loader: () => Promise<T>): Promise<T>;
  invalidate(key: LaneKey, options?: LaneInvalidateOptions): void;
  invalidateAll(scope: LaneScope, options?: LaneInvalidateOptions): void;
  set<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T>;
  update<T>(key: LaneKey, updater: LaneUpdater<T>): Promise<T> | undefined;
  updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>): Promise<T>[];
  remove(key: LaneKey): void;
  removeAll(scope: LaneScope): void;
  onInvalidate(key: LaneKey, listener: LaneSubscription): LaneSubscription;
  onRemove(key: LaneKey, listener: LaneSubscription): LaneSubscription;
};

export type LaneResult<T> = {
  promise: Promise<T>;
  isPending: boolean;
  invalidate: () => void;
};

export type LaneRefetchOnMount = boolean | "always";

export type LaneUseOptions = {
  staleTime?: number;
  refetchOnMount?: LaneRefetchOnMount;
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
  invalidateListeners: Set<LaneSubscription>;
  removeListeners: Set<LaneSubscription>;
};

export function createLane(): Lane {
  const entries = new Map<string, LaneEntry>();

  function seed<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T> {
    const keyId = serializeKey(key);
    const entry = getOrCreateEntry(key, keyId);

    if (entry.cache) {
      return entry.cache.promise as Promise<T>;
    }

    return setEntryCache(entry, valueOrPromise);
  }

  function seedMany(seedEntries: readonly LaneEntrySeed[]): void {
    for (const [key, valueOrPromise] of seedEntries) {
      seed(key, valueOrPromise);
    }
  }

  function readOrCreate<T>(
    key: LaneKey,
    loader: () => Promise<T>,
  ): Promise<T> {
    const keyId = serializeKey(key);
    const entry = getOrCreateEntry(key, keyId);

    if (entry.cache) {
      return entry.cache.promise as Promise<T>;
    }

    return setEntryCache(entry, createLoaderPromise(loader));
  }

  function invalidate(
    key: LaneKey,
    options: LaneInvalidateOptions = {},
  ): void {
    const keyId = serializeKey(key);
    const entry = entries.get(keyId);

    if (!entry) {
      return;
    }

    invalidateEntry(entry, options);
  }

  function invalidateAll(
    scope: LaneScope,
    options: LaneInvalidateOptions = {},
  ): void {
    for (const entry of matchingEntries(entries, scope)) {
      invalidateEntry(entry, options);
    }
  }

  function set<T>(
    key: LaneKey,
    valueOrPromise: LaneValue<T>,
  ): Promise<T> {
    const keyId = serializeKey(key);
    const entry = getOrCreateEntry(key, keyId);
    const promise = setEntryCache(entry, valueOrPromise);

    notify(entry.invalidateListeners);

    return promise;
  }

  function update<T>(
    key: LaneKey,
    updater: LaneUpdater<T>,
  ): Promise<T> | undefined {
    const keyId = serializeKey(key);
    const entry = entries.get(keyId);

    if (!entry) {
      return undefined;
    }

    return updateEntry(entry, updater);
  }

  function updateAll<T>(
    scope: LaneScope,
    updater: LaneUpdater<T>,
  ): Promise<T>[] {
    return matchingEntries(entries, scope).flatMap((entry) => {
      const promise = updateEntry(entry, updater);
      return promise ? [promise] : [];
    });
  }

  function remove(key: LaneKey): void {
    const keyId = serializeKey(key);
    const entry = entries.get(keyId);

    if (!entry) {
      return;
    }

    removeEntryCache(entry);
    notify(entry.removeListeners);
    cleanupEntry(entry);
  }

  function removeAll(scope: LaneScope): void {
    for (const entry of matchingEntries(entries, scope)) {
      removeEntryCache(entry);
      notify(entry.removeListeners);
      cleanupEntry(entry);
    }
  }

  function onInvalidate(
    key: LaneKey,
    listener: LaneSubscription,
  ): LaneSubscription {
    const entry = getOrCreateEntry(key, serializeKey(key));
    return subscribe(entry.invalidateListeners, listener, () =>
      cleanupEntry(entry),
    );
  }

  function onRemove(
    key: LaneKey,
    listener: LaneSubscription,
  ): LaneSubscription {
    const entry = getOrCreateEntry(key, serializeKey(key));
    return subscribe(entry.removeListeners, listener, () => cleanupEntry(entry));
  }

  return {
    invalidate,
    invalidateAll,
    onInvalidate,
    onRemove,
    readOrCreate,
    remove,
    removeAll,
    seed,
    seedMany,
    set,
    update,
    updateAll,
  };

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

    notify(entry.invalidateListeners);

    return updated as Promise<T>;
  }

  function getOrCreateEntry(key: LaneKey, keyId: string): LaneEntry {
    const existing = entries.get(keyId);

    if (existing) {
      return existing;
    }

    const entry = createEntry(key, keyId);
    entries.set(keyId, entry);

    return entry;
  }

  function invalidateEntry(
    entry: LaneEntry,
    options: LaneInvalidateOptions,
  ): void {
    if (!shouldInvalidateEntry(entry, options)) {
      return;
    }

    removeEntryCache(entry);
    notify(entry.invalidateListeners);
    cleanupEntry(entry);
  }

  function cleanupEntry(entry: LaneEntry): void {
    if (
      entry.cache ||
      entry.invalidateListeners.size > 0 ||
      entry.removeListeners.size > 0
    ) {
      return;
    }

    entries.delete(entry.keyId);
  }

}

export function useLane<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
  options: LaneUseOptions = {},
): LaneResult<T> {
  const keyId = serializeKey(key);
  const [isPending, startTransition] = useTransition();
  const [promise, setPromise] = useState<Promise<T>>(() =>
    lane.readOrCreate(key, loader),
  );
  const [prevKeyId, setPrevKeyId] = useState(keyId);

  let effectivePromise = promise;

  if (keyId !== prevKeyId) {
    const nextPromise = lane.readOrCreate(key, loader);
    effectivePromise = nextPromise;

    setPrevKeyId(keyId);
    setPromise(nextPromise);
  }

  const onInvalidate = useEffectEvent((targetKey: LaneKey) => {
    startTransition(() => {
      setPromise(lane.readOrCreate(targetKey, loader));
    });
  });

  const onRemove = useEffectEvent((targetKey: LaneKey) => {
    const nextPromise = lane.readOrCreate(targetKey, loader);
    setPromise(nextPromise);
  });

  const refetchOnMount = useEffectEvent((targetKey: LaneKey) => {
    const invalidateOptions = invalidateOptionsForRefetchOnMount(options);

    if (!invalidateOptions) {
      return;
    }

    lane.invalidate(targetKey, invalidateOptions);
  });

  useEffect(() => {
    const unsubscribeInvalidate = lane.onInvalidate(key, () => {
      onInvalidate(key);
    });
    const unsubscribeRemove = lane.onRemove(key, () => {
      onRemove(key);
    });

    return () => {
      unsubscribeInvalidate();
      unsubscribeRemove();
    };
  }, [lane, keyId]);

  useEffect(() => {
    refetchOnMount(key);
  }, [lane, keyId, options.refetchOnMount, options.staleTime]);

  const invalidate = useCallback(() => {
    lane.invalidate(key);
  }, [lane, keyId]);

  return {
    invalidate,
    isPending,
    promise: effectivePromise,
  };
}

export function useLanePromise<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
  options?: LaneUseOptions,
): Promise<T> {
  return useLane(lane, key, loader, options).promise;
}

export function serializeKey(key: LaneKey): string {
  return stableStringify(key);
}

function subscribe(
  listeners: Set<LaneSubscription>,
  listener: LaneSubscription,
  cleanup: () => void,
): LaneSubscription {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    cleanup();
  };
}

function notify(listeners: Set<LaneSubscription>): void {
  for (const listener of [...listeners]) {
    listener();
  }
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

function isPrefixKey(prefix: LaneKey, key: LaneKey): boolean {
  if (prefix.length > key.length) {
    return false;
  }

  return prefix.every(
    (segment, index) => stableStringify(segment) === stableStringify(key[index]),
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
    invalidateListeners: new Set(),
    key,
    keyId,
    removeListeners: new Set(),
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

function invalidateOptionsForRefetchOnMount(
  options: LaneUseOptions,
): LaneInvalidateOptions | undefined {
  const refetchOnMount = options.refetchOnMount ?? false;

  if (refetchOnMount === false) {
    return undefined;
  }

  return refetchOnMount === "always"
    ? { onlyIf: "settled" }
    : { onlyIf: "stale", staleTime: options.staleTime };
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

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported Lane key value: ${String(value)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
