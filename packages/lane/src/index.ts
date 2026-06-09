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

export type Lane = {
  seed<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T>;
  seedMany(entries: readonly LaneEntrySeed[]): void;
  readOrCreate<T>(key: LaneKey, loader: () => Promise<T>): Promise<T>;
  invalidate(key: LaneKey): void;
  invalidateAll(scope: LaneScope): void;
  replace<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T>;
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

type LaneEntry = {
  key: LaneKey;
  keyId: string;
  promise: Promise<unknown>;
  invalidated: boolean;
};

type ListenerMap = Map<string, Set<LaneSubscription>>;

export function createLane(): Lane {
  const entries = new Map<string, LaneEntry>();
  const invalidateListeners: ListenerMap = new Map();
  const removeListeners: ListenerMap = new Map();

  function seed<T>(key: LaneKey, valueOrPromise: LaneValue<T>): Promise<T> {
    const keyId = serializeKey(key);
    const existing = entries.get(keyId);

    if (existing) {
      return existing.promise as Promise<T>;
    }

    const promise = normalizePromise(valueOrPromise);
    entries.set(keyId, {
      invalidated: false,
      key,
      keyId,
      promise,
    });

    return promise;
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
    const existing = entries.get(keyId);

    if (existing && !existing.invalidated) {
      return existing.promise as Promise<T>;
    }

    const promise = createLoaderPromise(loader);
    entries.set(keyId, {
      invalidated: false,
      key,
      keyId,
      promise,
    });

    return promise;
  }

  function invalidate(key: LaneKey): void {
    const keyId = serializeKey(key);
    const entry = entries.get(keyId);

    if (!entry) {
      return;
    }

    entry.invalidated = true;
    notify(invalidateListeners, keyId);
  }

  function invalidateAll(scope: LaneScope): void {
    for (const entry of matchingEntries(entries, scope)) {
      entry.invalidated = true;
      notify(invalidateListeners, entry.keyId);
    }
  }

  function replace<T>(
    key: LaneKey,
    valueOrPromise: LaneValue<T>,
  ): Promise<T> {
    const keyId = serializeKey(key);
    const promise = normalizePromise(valueOrPromise);

    entries.set(keyId, {
      invalidated: false,
      key,
      keyId,
      promise,
    });
    notify(invalidateListeners, keyId);

    return promise;
  }

  function remove(key: LaneKey): void {
    const keyId = serializeKey(key);

    if (!entries.delete(keyId)) {
      return;
    }

    notify(removeListeners, keyId);
  }

  function removeAll(scope: LaneScope): void {
    for (const entry of matchingEntries(entries, scope)) {
      entries.delete(entry.keyId);
      notify(removeListeners, entry.keyId);
    }
  }

  function onInvalidate(
    key: LaneKey,
    listener: LaneSubscription,
  ): LaneSubscription {
    return subscribe(invalidateListeners, serializeKey(key), listener);
  }

  function onRemove(
    key: LaneKey,
    listener: LaneSubscription,
  ): LaneSubscription {
    return subscribe(removeListeners, serializeKey(key), listener);
  }

  return {
    invalidate,
    invalidateAll,
    onInvalidate,
    onRemove,
    readOrCreate,
    remove,
    removeAll,
    replace,
    seed,
    seedMany,
  };
}

export function useLane<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
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
      const nextPromise = lane.readOrCreate(targetKey, loader);
      setPromise(nextPromise);
    });
  });

  const onRemove = useEffectEvent((targetKey: LaneKey) => {
    const nextPromise = lane.readOrCreate(targetKey, loader);
    setPromise(nextPromise);
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
): Promise<T> {
  return useLane(lane, key, loader).promise;
}

export function serializeKey(key: LaneKey): string {
  return stableStringify(key);
}

function subscribe(
  listeners: ListenerMap,
  keyId: string,
  listener: LaneSubscription,
): LaneSubscription {
  const listenersForKey = listeners.get(keyId) ?? new Set<LaneSubscription>();

  listenersForKey.add(listener);
  listeners.set(keyId, listenersForKey);

  return () => {
    listenersForKey.delete(listener);

    if (listenersForKey.size === 0) {
      listeners.delete(keyId);
    }
  };
}

function notify(listeners: ListenerMap, keyId: string): void {
  const listenersForKey = listeners.get(keyId);

  if (!listenersForKey) {
    return;
  }

  for (const listener of [...listenersForKey]) {
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
