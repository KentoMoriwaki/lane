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
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneResult,
  LaneUseOptions,
} from "./types";

export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options: LaneUseOptions = {},
): LaneResult<T> {
  const lane = useLaneInstance();
  const keyId = serializeKey(key);
  const readOptions: LaneReadOptions = {
    retry: options.retry,
    retryDelay: options.retryDelay,
  };
  const [isTransitionPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  const [promise, setPromise] = useState<Promise<T>>(() =>
    readOrCreate(lane, key, loader, readOptions),
  );
  const [prevSource, setPrevSource] = useState(() => ({ keyId, lane }));

  let effectivePromise = promise;

  if (lane !== prevSource.lane || keyId !== prevSource.keyId) {
    const nextPromise = readOrCreate(lane, key, loader, readOptions);
    effectivePromise = nextPromise;

    setPrevSource({ keyId, lane });
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
    lane,
    keyId,
    options.gcTime,
    options.refetchInterval,
    options.refetchOnFocus,
    options.refetchOnReconnect,
    options.staleTime,
  ]);

  useEffect(() => {
    refetchOnMount(lane, keyId);
  }, [lane, keyId]);

  const invalidate = useCallback(() => {
    invalidateEntry(lane, keyId);
  }, [lane, keyId]);

  return {
    invalidate,
    isBackgroundPending,
    isTransitionPending,
    promise: effectivePromise,
    refreshError: readRefreshError(lane, keyId),
  };
}

export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): Promise<T> {
  return useLane(key, loader, options).promise;
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
