"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
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
import { LaneHydrationSourceContext } from "./hydration";
import { serializeKey } from "./keys";
import { useLaneContext } from "./provider";
import { revalidateOptions, toReadOptions } from "./read-options";
import type {
  Lane,
  LaneExternalReadSpec,
  LaneExternalResult,
  LaneGatedExternalReadSpec,
  LaneGatedExternalResult,
  LaneGatedReadSpec,
  LaneGatedResult,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneRead,
  LaneReadSpec,
  LaneResult,
  LaneUseOptions,
} from "./types";

/**
 * Every read the hook accepts, as one shape — the implementation's parameter,
 * never a caller's. The loader is a plain {@link LaneLoader} here (`external` is
 * one, brand aside), which is what lets the body stay free of a single test for
 * *which* kind of read it is holding: one `readOrCreate` per path, and the store
 * is where the difference lives.
 */
type LaneAnyReadSpec<T, C> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneLoader<T, C> | undefined;
};

/**
 * An external read — `loader: external`. The result is a {@link LaneResult}
 * without `invalidate`: the entry is filled by whoever publishes it, so there is
 * no loader here to re-run and nothing for a client-side invalidation to do but
 * empty a key it does not own (which the store throws on). Everything else — the
 * promise, both pending flags, the transition semantics — is identical, because
 * the wait *is* a read.
 */
export function useLane<T>(read: LaneExternalReadSpec<T>): LaneExternalResult<T>;
export function useLane<T, C = T>(read: LaneReadSpec<T, C>): LaneResult<T>;
export function useLane<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): LaneGatedResult<T>;
export function useLane<T>(
  read: LaneGatedExternalReadSpec<T>,
): LaneGatedExternalResult<T>;
export function useLane<T, C = T>(
  read: LaneAnyReadSpec<T, C>,
):
  | LaneResult<T>
  | LaneGatedResult<T>
  | LaneExternalResult<T>
  | LaneGatedExternalResult<T> {
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
  const [isInvalidationPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  // The publication this render is happening under (nearest LaneHydration
  // boundary, or the stable `undefined` outside one). Part of the read's
  // source: a republish is a new source the same way a new key is.
  const hydrationSource = useContext(LaneHydrationSourceContext);
  const [promise, setPromise] = useState<Promise<LaneRead<T>> | undefined>(() =>
    loader !== undefined
      ? readOrCreate(lane, keyId, key, loader, readOptions)
      : undefined,
  );
  // Deliberately state and not a ref, because the switch branch below only fires
  // while this has *not* committed. A transition that suspends throws its render
  // away, so the next attempt sees the old source again and re-reads whatever the
  // store holds by then — which is how a reader switching keys converges on a
  // write it was never notified of (it is still subscribed to the old key). A ref
  // would survive the discarded render and leave the branch already satisfied, so
  // the retry would commit the *previous* key's promise and wait for the
  // post-subscribe catch-up to repair it.
  //
  // `key` rides along as the key object of record for the current source: it is
  // replaced only when the source switches, so its identity follows `keyId` —
  // which is what lets the effects below depend on a key *object* without
  // re-firing on a caller's structurally re-created array.
  const [prevSource, setPrevSource] = useState(() => ({
    enabled,
    hydration: hydrationSource,
    key,
    keyId,
    lane,
  }));

  let effectivePromise = promise;

  // A change in source identity — the key, the lane, `enabled`, or the
  // publication rendered under — switches the read during render: enabling
  // reads the (possibly cached) promise immediately, disabling drops to
  // `undefined` without an extra render of stale data. The hydration dimension
  // is what carries a republish to readers no notification can reach: a hidden
  // `<Activity>` reader is unsubscribed, but the reveal that re-streamed the
  // payload re-renders it under a new publication, and this branch adopts the
  // already-published seed in that same render — inside the revealing
  // transition, so the framework's fetch-then-reveal stays a single commit
  // with no fallback. (A reader whose key was not in the publication re-reads
  // into its own current cache: a no-op.)
  if (
    enabled !== prevSource.enabled ||
    lane !== prevSource.lane ||
    keyId !== prevSource.keyId ||
    hydrationSource !== prevSource.hydration
  ) {
    const nextPromise =
      loader !== undefined
        ? readOrCreate(lane, keyId, key, loader, readOptions)
        : undefined;
    effectivePromise = nextPromise;

    setPrevSource({ enabled, hydration: hydrationSource, key, keyId, lane });
    setPromise(nextPromise);
  }

  // The reactive form of the key, for effects: one object identity per source.
  // Committed renders always see it in agreement with `keyId` — the switch
  // above replaces both in the same render.
  const sourceKey = prevSource.key;

  const onInvalidate = useEffectEvent((
    targetLane: Lane,
    targetKeyId: string,
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
      setPromise(
        readOrCreate(targetLane, targetKeyId, targetKey, loader, readOptions, gate),
      );
    };

    if (source === "background") {
      startBackgroundTransition(updatePromise);
      return;
    }

    startTransition(updatePromise);
  });

  const onRemove = useEffectEvent((
    targetLane: Lane,
    targetKeyId: string,
    targetKey: LaneKey,
  ) => {
    if (loader === undefined) {
      return;
    }

    const nextPromise = readOrCreate(
      targetLane,
      targetKeyId,
      targetKey,
      loader,
      readOptions,
    );
    setPromise(nextPromise);
  });

  // The last link in the chain of checks, and the only one that can close its
  // window. Renders re-read the store on every attempt (initializer, source
  // switch), the layout reconciliation checks again inside the commit — but
  // the subscription only starts in this passive effect, and a store change
  // landing between that reconciliation and this subscribe (a timer, a socket,
  // another component's effect) reaches neither: the checks are over and the
  // notifications have not begun. A visible reader that misses it has no
  // re-appearance coming to reconcile it, so however narrow the window, the
  // failure mode is rendering an abandoned promise forever.
  //
  // This is the notification channel's completeness patch, not the reveal's —
  // the reader is a continued appearance, so the correction impersonates the
  // notification it missed, transition semantics included. Hidden-reveal and
  // republish convergence, which once ran through here, belong to the layout
  // reconciliation and the hydration source switch above.
  const syncAfterSubscribe = useEffectEvent((
    targetLane: Lane,
    targetKeyId: string,
    targetKey: LaneKey,
  ) => {
    if (loader === undefined) {
      return;
    }

    const nextPromise = readOrCreate(
      targetLane,
      targetKeyId,
      targetKey,
      loader,
      readOptions,
    );

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
    if (latestNotifySource(targetLane, targetKeyId) === "transition") {
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

  // The commit invariant: a reader only ever commits the store's current
  // promise. Normal operation upholds it by construction — notifications reach
  // subscribed readers, pre-commit render attempts re-run the `useState`
  // initializer, and the switch branch re-reads on a source change. The one
  // breach React can create is re-showing a previously committed tree whose
  // effects were torn down in between: an `<Activity>` reveal (and the same
  // shape, a boundary returning from a re-suspension). No render happens there
  // unless an input changed, and passive effects flush after paint — only a
  // layout effect, re-created inside the reveal commit before paint, can decide
  // what the first revealed frame shows.
  //
  // Deliberately synchronous, never a transition: a reveal is a new appearance,
  // not the continuation the SWR channel serves. What the correction shows is
  // decided by what the store holds. A pending replacement — including the
  // re-read this very call starts on a repudiated or removed entry — suspends
  // into the boundary's fallback, which is the specified presentation for
  // repudiated content at a new appearance; the read starting here is what
  // "the read begins at the reveal" means. A replacement that settled while
  // hidden (a sibling's finished read, a set() nobody saw) suspends only until
  // React instruments the already-resolved thenable and replays — the outdated
  // value never reappears either way. Note the republish case does not land
  // here: a reveal that carries a publication re-renders under a new hydration
  // source and adopts during that render (see the source switch above), so
  // this correction is the net for reveals no signal reached. A merely stale
  // entry reuses its cache (`whenStale: "revalidate"`), so staleness never
  // enters this channel; `whenStale: "refetch"` discards it here exactly as it
  // would on a remount.
  const reconcileOnReveal = useEffectEvent((
    targetLane: Lane,
    targetKeyId: string,
    targetKey: LaneKey,
  ) => {
    if (loader === undefined) {
      return;
    }

    const nextPromise = readOrCreate(
      targetLane,
      targetKeyId,
      targetKey,
      loader,
      readOptions,
    );

    if (nextPromise !== promise) {
      setPromise(nextPromise);
    }
  });

  // The effect depends on — and hands the event — the read's full identity:
  // `lane`, the canonical `keyId`, and `sourceKey`, whose object identity
  // follows it. The event exists only for what must *not* be reactive here
  // (`promise`, `loader`, `readOptions`).
  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    // Deliberately a synchronous setState; see the commit-invariant comment
    // above.
    // oxlint-disable-next-line react/react-compiler
    reconcileOnReveal(lane, keyId, sourceKey);
  }, [enabled, lane, keyId, sourceKey]);

  // Deliberately a *passive* effect. A boundary that re-suspends hides the
  // subtree it had already committed and tears down its layout effects while
  // leaving passive ones mounted, so a passive subscription keeps receiving
  // notifications for as long as the fallback is up. Re-hydration is built on
  // exactly that: `LaneHydration` suspends and publishes from a macrotask rather
  // than from an effect (see `hydration.ts`), which reaches already-mounted
  // readers only because hiding them did not unsubscribe them. Moving this to
  // `useLayoutEffect` would silently sever that. The layout reconciliation
  // above is the counterpart for what passive timing cannot cover — the first
  // frame of a reveal — and carries no subscription of its own.
  useEffect(() => {
    // A disabled read owns no entry: no subscription, no GC anchor, no
    // revalidation. The effect re-runs when `enabled` flips and subscribes then.
    // The subscription is pure notify + GC; option changes never re-run it.
    if (!enabled) {
      return;
    }

    // The subscription is plainly reactive — `sourceKey` is the key object
    // whose identity is the source's — so it lives in the effect, not behind an
    // event: anything new it comes to read is forced into the deps.
    const unsubscribe = subscribeLane(lane, keyId, sourceKey, {
      onInvalidate: (entry, source, gate) => {
        onInvalidate(lane, entry.keyId, entry.key, source, gate);
      },
      onRemove: (entry) => {
        onRemove(lane, entry.keyId, entry.key);
      },
    });

    syncAfterSubscribe(lane, keyId, sourceKey);

    return unsubscribe;
  }, [enabled, lane, keyId, sourceKey]);

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
    isInvalidationPending,
    promise: effectivePromise,
  };
}

export function useLanePromise<T>(
  read: LaneExternalReadSpec<T>,
): Promise<LaneRead<T>>;
export function useLanePromise<T, C = T>(
  read: LaneReadSpec<T, C>,
): Promise<LaneRead<T>>;
export function useLanePromise<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): Promise<LaneRead<T>> | undefined;
export function useLanePromise<T>(
  read: LaneGatedExternalReadSpec<T>,
): Promise<LaneRead<T>> | undefined;
export function useLanePromise<T, C = T>(
  read: LaneAnyReadSpec<T, C>,
): Promise<LaneRead<T>> | undefined {
  return useLane<T, C>(read).promise;
}
