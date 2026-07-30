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
  invalidationSource,
  latestNotifySource,
  readOrCreate,
  subscribeLane,
} from "./core";
import type { LaneInvalidationSource } from "./core";
import { serializeKey } from "./keys";
import { useLaneContext } from "./provider";
import { revalidateOptions, toReadOptions } from "./read-options";
import type {
  Lane,
  LaneGatedReadSpec,
  LaneGatedResult,
  LaneInvalidateOptions,
  LaneKey,
  LaneRead,
  LaneReadSpec,
  LaneResult,
} from "./types";

export function useLane<T, C = T>(read: LaneReadSpec<T, C>): LaneResult<T>;
export function useLane<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): LaneGatedResult<T>;
export function useLane<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): LaneResult<T> | LaneGatedResult<T> {
  // A read is one value: its key, its loader, and the options it is read with.
  // The value doubles as the options bag — no destructuring into a normalized
  // copy — so every option is read fresh on each render and at each fire time.
  const { key, loader } = read;

  // One context read for all three. `loaderMeta` is the dependency the loader is
  // handed, from the lane rather than from the read — which is what lets the
  // read's arguments stay exactly what decides its key. Read here so the
  // render-path read below carries it, and closed over by the `useEffectEvent`
  // callbacks so a re-read carries the latest.
  const { lane, revalidation, loaderMeta } = useLaneContext("useLane");
  // A read is "enabled" exactly when a loader is supplied. Lane only loads
  // external data, so an absent loader has no other meaning and is the single,
  // unambiguous disable signal: no fetch, no subscription, no stored entry.
  const enabled = loader !== undefined;
  const keyId = serializeKey(key);
  const readOptions = toReadOptions(read, loaderMeta);
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
    setPromise(() =>
      loader !== undefined ? readOrCreate(lane, key, loader, readOptions) : undefined,
    );
  }

  const onInvalidate = useEffectEvent((
    targetLane: Lane,
    targetKey: LaneKey,
    source: LaneInvalidationSource,
    gate: Promise<void> | undefined,
  ) => {
    // Only fires while subscribed, which never happens without a loader; the
    // guard also narrows `loader` to non-undefined for the read below.
    if (loader === undefined) {
      return;
    }

    const updatePromise = () => {
      setPromise(() =>
        readOrCreate(targetLane, targetKey, loader, readOptions, gate),
      );
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

    setPromise(() => readOrCreate(targetLane, targetKey, loader, readOptions));
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

    const apply = () => {
      setPromise(nextPromise);
    };

    // Converge through the same kind of transition as the notification this
    // reader was not subscribed in time to receive, so siblings of one key agree
    // on which pending flag the update sets. Nothing recorded means nothing
    // user-driven to join: stay in the background.
    if (
      latestNotifySource(targetLane, serializeKey(targetKey)) === "transition"
    ) {
      startTransition(apply);
      return;
    }

    startBackgroundTransition(apply);
  });

  const refetchOnMount = useEffectEvent(
    (targetLane: Lane, targetKeyId: string) => {
      const invalidateOptions = revalidateOptions(
        read.refetchOnMount,
        read.staleTime,
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
      read.refetchOnFocus,
      read.staleTime,
    );

    if (!invalidateOptions) {
      return;
    }

    invalidateEntry(lane, keyId, invalidateOptions, "background");
  });

  const revalidateOnReconnect = useEffectEvent(() => {
    const invalidateOptions = revalidateOptions(
      read.refetchOnReconnect,
      read.staleTime,
    );

    if (!invalidateOptions) {
      return;
    }

    invalidateEntry(lane, keyId, invalidateOptions, "background");
  });

  // Deliberately a *passive* effect. A boundary that re-suspends hides the
  // subtree it had already committed and tears down its layout effects while
  // leaving passive ones mounted, so a passive subscription keeps receiving
  // notifications for as long as the fallback is up. Re-hydration is built on
  // exactly that: `LaneHydration` suspends and publishes from a macrotask rather
  // than from an effect (see `hydration.ts`), which reaches already-mounted
  // readers only because hiding them did not unsubscribe them. Moving this to
  // `useLayoutEffect` would silently sever that.
  useEffect(() => {
    // A disabled read owns no entry: no subscription, no GC anchor, no
    // revalidation. The effect re-runs when `enabled` flips and subscribes then.
    // The subscription is pure notify + GC; option changes never re-run it.
    if (!enabled) {
      return;
    }

    const unsubscribe = subscribeLane(lane, key, {
      onInvalidate: (entry, source, gate) => {
        onInvalidate(lane, entry.key, source, gate);
      },
      onRemove: (entry) => {
        onRemove(lane, entry.key);
      },
    });

    void syncAfterSubscribe;

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

  const invalidate = useCallback(
    (options?: LaneInvalidateOptions) => {
      invalidateEntry(lane, keyId, options, invalidationSource(options));
    },
    [lane, keyId],
  );

  return {
    invalidate,
    isBackgroundPending,
    isTransitionPending,
    promise: effectivePromise,
  };
}

export function useLanePromise<T, C = T>(
  read: LaneReadSpec<T, C>,
): Promise<LaneRead<T>>;
export function useLanePromise<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): Promise<LaneRead<T>> | undefined;
export function useLanePromise<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): Promise<LaneRead<T>> | undefined {
  return useLane<T, C>(read).promise;
}
