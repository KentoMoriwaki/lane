"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";
import { invalidateEntry, readOrCreate, subscribeLane } from "./core";
import type { LaneInvalidationSource } from "./core";
import { serializeKey } from "./keys";
import { useLaneInstance, useLaneRevalidation } from "./provider";
import { revalidateOptions, toReadOptions } from "./read-options";
import type {
  Lane,
  LaneGatedResult,
  LaneKey,
  LaneLoader,
  LaneRead,
  LaneResult,
  LaneUseOptions,
} from "./types";

export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): LaneResult<T>;
export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T> | undefined,
  options?: LaneUseOptions,
): LaneGatedResult<T>;
export function useLane<T>(
  key: LaneKey,
  loader: LaneLoader<T> | undefined,
  options: LaneUseOptions = {},
): LaneResult<T> | LaneGatedResult<T> {
  const lane = useLaneInstance();
  const revalidation = useLaneRevalidation();
  // A read is "enabled" exactly when a loader is supplied. Lane only loads
  // external data, so an absent loader has no other meaning and is the single,
  // unambiguous disable signal: no fetch, no subscription, no stored entry.
  const enabled = loader !== undefined;
  const keyId = serializeKey(key);
  const readOptions = toReadOptions(options);
  const [isTransitionPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  const [promise, setPromise] = useState<Promise<LaneRead<T>> | undefined>(() =>
    loader !== undefined ? readOrCreate(lane, key, loader, readOptions) : undefined,
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
    const nextPromise =
      loader !== undefined
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
    // Only fires while subscribed, which never happens without a loader; the
    // guard also narrows `loader` to non-undefined for the read below.
    if (loader === undefined) {
      return;
    }

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
    if (loader === undefined) {
      return;
    }

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
    if (loader === undefined) {
      return;
    }

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
      const invalidateOptions = revalidateOptions(
        options.refetchOnMount,
        options.staleTime,
      );

      if (!invalidateOptions) {
        return;
      }

      invalidateEntry(targetLane, targetKeyId, invalidateOptions, "background");
    },
  );

  // Focus / reconnect are lane-level events the provider fans out; each reader
  // refreshes its own key with the trigger's policy. Read latest options at
  // fire time, so toggling the flag never re-subscribes.
  const revalidateOnFocus = useEffectEvent(() => {
    const invalidateOptions = revalidateOptions(
      options.refetchOnFocus,
      options.staleTime,
    );

    if (!invalidateOptions) {
      return;
    }

    invalidateEntry(lane, keyId, invalidateOptions, "background");
  });

  const revalidateOnReconnect = useEffectEvent(() => {
    const invalidateOptions = revalidateOptions(
      options.refetchOnReconnect,
      options.staleTime,
    );

    if (!invalidateOptions) {
      return;
    }

    invalidateEntry(lane, keyId, invalidateOptions, "background");
  });

  useEffect(() => {
    // A disabled read owns no entry: no subscription, no GC anchor, no
    // revalidation. The effect re-runs when `enabled` flips and subscribes then.
    // The subscription is pure notify + GC; option changes never re-run it.
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
    });

    syncAfterSubscribe(lane, key);

    return unsubscribe;
  }, [enabled, lane, keyId]);

  useEffect(() => {
    // Focus / reconnect belong to the provider; the reader just registers its
    // handlers. They read the latest key/options at fire time, so nothing here
    // depends on the key or a flag — only on being enabled.
    if (!enabled) {
      return;
    }

    return revalidation.subscribe({
      onFocus: revalidateOnFocus,
      onReconnect: revalidateOnReconnect,
    });
  }, [enabled, revalidation]);

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
  };
}

export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T>,
  options?: LaneUseOptions,
): Promise<LaneRead<T>>;
export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T> | undefined,
  options?: LaneUseOptions,
): Promise<LaneRead<T>> | undefined;
export function useLanePromise<T>(
  key: LaneKey,
  loader: LaneLoader<T> | undefined,
  options?: LaneUseOptions,
): Promise<LaneRead<T>> | undefined {
  return useLane(key, loader, options ?? {}).promise;
}
