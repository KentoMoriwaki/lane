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
  subscribeLane,
} from "./core";
import type { LaneInvalidationSource } from "./core";
import { serializeKey } from "./keys";
import { useLaneInstance } from "./provider";
import type {
  Lane,
  LaneInvalidateOptions,
  LaneKey,
  LaneResult,
  LaneUseOptions,
} from "./types";

export function useLane<T>(
  key: LaneKey,
  loader: () => Promise<T>,
  options: LaneUseOptions = {},
): LaneResult<T> {
  const lane = useLaneInstance();
  const keyId = serializeKey(key);
  const [isTransitionPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  const [promise, setPromise] = useState<Promise<T>>(() =>
    readOrCreate(lane, key, loader),
  );
  const [prevSource, setPrevSource] = useState(() => ({ keyId, lane }));

  let effectivePromise = promise;

  if (lane !== prevSource.lane || keyId !== prevSource.keyId) {
    const nextPromise = readOrCreate(lane, key, loader);
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
      setPromise(readOrCreate(targetLane, targetKey, loader));
    };

    if (source === "background") {
      startBackgroundTransition(updatePromise);
      return;
    }

    startTransition(updatePromise);
  });

  const onRemove = useEffectEvent((targetLane: Lane, targetKey: LaneKey) => {
    const nextPromise = readOrCreate(targetLane, targetKey, loader);
    setPromise(nextPromise);
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
    return subscribeLane(lane, keyId, {
      onInvalidate: (entry, source) => {
        onInvalidate(lane, entry.key, source);
      },
      onRemove: (entry) => {
        onRemove(lane, entry.key);
      },
      options: {
        refetchOnFocus: options.refetchOnFocus,
        staleTime: options.staleTime,
      },
    });
  }, [lane, keyId, options.refetchOnFocus, options.staleTime]);

  useEffect(() => {
    refetchOnMount(lane, keyId);
  }, [lane, keyId]);

  const invalidate = useCallback(() => {
    invalidateEntry(lane, keyId);
  }, [lane, keyId]);

  return {
    isBackgroundPending,
    isTransitionPending,
    invalidate,
    promise: effectivePromise,
  };
}

export function useLanePromise<T>(
  key: LaneKey,
  loader: () => Promise<T>,
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
