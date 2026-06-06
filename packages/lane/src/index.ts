import { startTransition, useEffect, useMemo, useState } from "react";

export type LaneKey = readonly unknown[];

export type LaneListener<T> = (promise: Promise<T>) => void;

export type Lane = {
  get<T>(key: LaneKey, loader: () => Promise<T>): Promise<T>;
  refresh<T>(key: LaneKey, loader: () => Promise<T>): Promise<T>;
  subscribe<T>(key: LaneKey, listener: LaneListener<T>): () => void;
};

type UnknownListener = (promise: Promise<unknown>) => void;

export function createLane(): Lane {
  const queryPromises = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<UnknownListener>>();

  function get<T>(key: LaneKey, loader: () => Promise<T>): Promise<T> {
    const id = serializeKey(key);
    const cachedPromise = queryPromises.get(id);

    if (cachedPromise) {
      return cachedPromise as Promise<T>;
    }

    const promise = createPromise(loader);
    queryPromises.set(id, promise);
    return promise;
  }

  function refresh<T>(key: LaneKey, loader: () => Promise<T>): Promise<T> {
    const id = serializeKey(key);
    const promise = createPromise(loader);

    queryPromises.set(id, promise);
    notify(id, promise);

    return promise;
  }

  function subscribe<T>(key: LaneKey, listener: LaneListener<T>) {
    const id = serializeKey(key);
    const listenersForKey = listeners.get(id) ?? new Set<UnknownListener>();

    listenersForKey.add(listener as UnknownListener);
    listeners.set(id, listenersForKey);

    return () => {
      listenersForKey.delete(listener as UnknownListener);

      if (listenersForKey.size === 0) {
        listeners.delete(id);
      }
    };
  }

  function notify(id: string, promise: Promise<unknown>) {
    const listenersForKey = listeners.get(id);

    if (!listenersForKey) {
      return;
    }

    for (const listener of listenersForKey) {
      listener(promise);
    }
  }

  return {
    get,
    refresh,
    subscribe,
  };
}

export function useLanePromise<T>(
  lane: Lane,
  key: LaneKey,
  loader: () => Promise<T>,
): Promise<T> {
  const keyId = useMemo(() => serializeKey(key), [key]);
  const [promise, setPromise] = useState<Promise<T>>(() =>
    lane.get(key, loader),
  );

  useEffect(() => {
    const unsubscribe = lane.subscribe<T>(key, (nextPromise) => {
      setPromise(nextPromise);
    });

    const latestPromise = lane.get(key, loader);

    startTransition(() => {
      setPromise((currentPromise) =>
        currentPromise === latestPromise ? currentPromise : latestPromise,
      );
    });

    return unsubscribe;
  }, [lane, keyId, loader]);

  return promise;
}

export function serializeKey(key: LaneKey): string {
  return stableStringify(key);
}

function createPromise<T>(factory: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(factory);
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

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported Lane key value: ${String(value)}`);
}
