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
  onInvalidate as subscribeInvalidate,
  onRemove as subscribeRemove,
  readOrCreate,
} from "./core";
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
  const [isPending, startTransition] = useTransition();
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

  const onInvalidate = useEffectEvent((targetKey: LaneKey) => {
    startTransition(() => {
      setPromise(readOrCreate(lane, targetKey, loader));
    });
  });

  const onRemove = useEffectEvent((targetKey: LaneKey) => {
    const nextPromise = readOrCreate(lane, targetKey, loader);
    setPromise(nextPromise);
  });

  const refetchOnMount = useEffectEvent(
    (targetLane: Lane, targetKeyId: string) => {
      const invalidateOptions = invalidateOptionsForRefetchOnMount(options);

      if (!invalidateOptions) {
        return;
      }

      invalidateEntry(targetLane, targetKeyId, invalidateOptions);
    },
  );

  useEffect(() => {
    const unsubscribeInvalidate = subscribeInvalidate(lane, keyId, (entry) => {
      onInvalidate(entry.key);
    });
    const unsubscribeRemove = subscribeRemove(lane, keyId, (entry) => {
      onRemove(entry.key);
    });

    return () => {
      unsubscribeInvalidate();
      unsubscribeRemove();
    };
  }, [lane, keyId]);

  useEffect(() => {
    refetchOnMount(lane, keyId);
  }, [lane, keyId]);

  const invalidate = useCallback(() => {
    invalidateEntry(lane, keyId);
  }, [lane, keyId]);

  return {
    invalidate,
    isPending,
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
