"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";
import {
  invalidateEntry,
  readOrCreate,
  readRefreshError,
  subscribeLane,
} from "./core";
import type { LaneInvalidationSource, LaneReadOptions } from "./core";
import { serializeKey } from "./keys";
import { useLaneInstance } from "./provider";
import type {
  Lane,
  LaneGatedResult,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneResult,
  LaneUseOptions,
} from "./types";

export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: Omit<LaneUseOptions, "enabled"> & { enabled?: true },
): LaneResult<T>;
export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): LaneGatedResult<T>;
export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options: LaneUseOptions = {},
): LaneResult<T> | LaneGatedResult<T> {
  const lane = useLaneInstance();
  const enabled = options.enabled ?? true;
  const keyId = serializeKey(key);
  const readOptions: LaneReadOptions = {
    retry: options.retry,
    retryDelay: options.retryDelay,
  };
  const [isTransitionPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  const [promise, setPromise] = useState<Promise<T> | undefined>(() =>
    enabled ? readOrCreate(lane, key, loader, readOptions) : undefined,
  );
  const [prevSource, setPrevSource] = useState(() => ({ enabled, keyId, lane }));

  let effectivePromise = promise;

  // A change in source identity OR in `enabled` switches the read during render:
  // enabling reads the (possibly cached) promise immediately, disabling drops to
  // `undefined` without an extra render of stale data.
  if (
    enabled !== prevSource.enabled ||
    lane !== prevSource.lane ||
    keyId !== prevSource.keyId
  ) {
    const nextPromise = enabled
      ? readOrCreate(lane, key, loader, readOptions)
      : undefined;
    effectivePromise = nextPromise;

    setPrevSource({ enabled, keyId, lane });
    setPromise(nextPromise);
  }

  const onInvalidate = useEffectEvent((
    targetLane: Lane,
    targetKey: LaneKey,
    source: LaneInvalidationSource,
  ) => {
    const updatePromise = () => {
      setPromise(readOrCreate(targetLane, targetKey, loader, readOptions));
    };

    if (source === "background") {
      startBackgroundTransition(updatePromise);
      return;
    }

    startTransition(updatePromise);
  });

  const onRemove = useEffectEvent((targetLane: Lane, targetKey: LaneKey) => {
    const nextPromise = readOrCreate(targetLane, targetKey, loader, readOptions);
    setPromise(nextPromise);
  });

  // Invalidations and removals that happen between render and subscription
  // reach no subscriber. This is common while the initial read keeps the
  // component suspended, because effects only run after it unsuspends.
  // Catching up right after subscribing keeps the hook converged with the
  // store instead of rendering an abandoned promise forever.
  const syncAfterSubscribe = useEffectEvent((
    targetLane: Lane,
    targetKey: LaneKey,
  ) => {
    const nextPromise = readOrCreate(targetLane, targetKey, loader, readOptions);

    if (nextPromise === promise) {
      return;
    }

    startBackgroundTransition(() => {
      setPromise(nextPromise);
    });
  });

  const refetchOnMount = useEffectEvent(
    (targetLane: Lane, targetKeyId: string) => {
      const invalidateOptions = invalidateOptionsForRefetchOnMount(options);

      if (!invalidateOptions) {
        return;
      }

      invalidateEntry(
        targetLane,
        targetKeyId,
        invalidateOptions,
        "background",
      );
    },
  );

  useEffect(() => {
    // A disabled read owns no entry: no subscription, no GC anchor, no
    // revalidation. The effect re-runs when `enabled` flips and subscribes then.
    if (!enabled) {
      return;
    }

    const unsubscribe = subscribeLane(lane, key, {
      onInvalidate: (entry, source) => {
        onInvalidate(lane, entry.key, source);
      },
      onRemove: (entry) => {
        onRemove(lane, entry.key);
      },
      options: {
        gcTime: options.gcTime,
        refetchInterval: options.refetchInterval,
        refetchOnFocus: options.refetchOnFocus,
        refetchOnReconnect: options.refetchOnReconnect,
        staleTime: options.staleTime,
      },
    });

    syncAfterSubscribe(lane, key);

    return unsubscribe;
  }, [
    enabled,
    lane,
    keyId,
    options.gcTime,
    options.refetchInterval,
    options.refetchOnFocus,
    options.refetchOnReconnect,
    options.staleTime,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    refetchOnMount(lane, keyId);
  }, [enabled, lane, keyId]);

  const invalidate = useCallback(() => {
    invalidateEntry(lane, keyId);
  }, [lane, keyId]);

  return {
    invalidate,
    isBackgroundPending,
    isTransitionPending,
    promise: effectivePromise,
    refreshError: enabled ? readRefreshError(lane, keyId) : undefined,
  };
}

export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: Omit<LaneUseOptions, "enabled"> & { enabled?: true },
): Promise<T>;
export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): Promise<T> | undefined;
export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): Promise<T> | undefined {
  return useLane(key, loader, options ?? {}).promise;
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
