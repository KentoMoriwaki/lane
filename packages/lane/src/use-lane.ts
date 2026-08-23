"use client";

import {
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  invalidateEntry,
  invalidationSource,
  peekEntryPromise,
  readOrCreate,
  subscribeLane,
} from "./core";
import type { LaneInvalidationSource, LaneReadOptions } from "./core";
import { LaneHydrationSourceContext } from "./hydration";
import { serializeKey } from "./keys";
import { isExternalLoader } from "./ownership";
import { useLaneContext } from "./provider";
import { revalidateOptions, toReadOptions } from "./read-options";
import type {
  Lane,
  LaneExternalReadSpec,
  LaneFallback,
  LaneGatedExternalReadSpec,
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
 * Internal union of every read shape the hook accepts. The loader is a plain
 * {@link LaneLoader} (`external` is one, brand aside), so the body never
 * branches on which kind of read it holds.
 */
type LaneAnyReadSpec<T, C> = LaneUseOptions & {
  key: LaneKey;
  loader: LaneLoader<T, C> | undefined;
  fallback?: LaneFallback<T>;
};

/**
 * A reader's subscription: opened in a layout effect, closed in a passive one
 * (see the two effects below for why the halves are split). The handle carries
 * one half to the other; `lane`/`keyId` let the opening half recognise a
 * subscription it already owns.
 */
type LaneReaderSubscription = {
  close: () => void;
  keyId: string;
  lane: Lane;
};

/**
 * An external read (`loader: external`) returns the same {@link LaneResult} a
 * client-owned one does. `invalidate` marks the key stale and Lane asks its
 * owner to publish again through the lane's `refresh`; the read is otherwise
 * identical, down to the transition it converges in.
 */
export function useLane<T>(read: LaneExternalReadSpec<T>): LaneResult<T>;
export function useLane<T, C = T>(read: LaneReadSpec<T, C>): LaneResult<T>;
export function useLane<T, C = T>(
  read: LaneGatedReadSpec<T, C>,
): LaneGatedResult<T>;
export function useLane<T>(
  read: LaneGatedExternalReadSpec<T>,
): LaneGatedResult<T>;
export function useLane<T, C = T>(
  read: LaneAnyReadSpec<T, C>,
): LaneResult<T> | LaneGatedResult<T> {
  // `read` doubles as the options bag — no normalized copy — so every option is
  // read fresh on each render and at each fire time.
  const { key, loader } = read;

  const { lane, revalidation, loaderMeta } = useLaneContext("useLane");
  // No loader = disabled: no fetch, no subscription, no stored entry.
  const enabled = loader !== undefined;
  // Only decides whether the hydration lineage below is part of this read's
  // source; every read path stays one unconditional `readOrCreate`.
  const external = isExternalLoader(loader);
  const keyId = serializeKey(key);
  const readOptions = toReadOptions(
    read,
    loaderMeta,
    read.fallback as LaneReadOptions["fallback"],
  );
  const [isInvalidationPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  // The publication this render happens under (nearest LaneHydration boundary,
  // or `undefined` outside one); a republish is a new source like a new key.
  // Read conditionally (`use`, which React allows conditionally) so a
  // client-owned read never becomes a consumer of the lineage: a publication
  // must not re-render — or worse, re-read — a read that supplies its own
  // value. For an unsubscribed hidden reader a spurious re-read is not a no-op
  // (it can re-create — and start loading — an entry the GC already swept), so
  // the narrowing is correctness, not optimization.
  const hydrationSource = external
    ? use(LaneHydrationSourceContext)
    : undefined;
  const [promise, setPromise] = useState<Promise<LaneRead<T>> | undefined>(() =>
    loader !== undefined
      ? readOrCreate(lane, keyId, key, loader, readOptions)
      : undefined,
  );
  // The promise this reader has *adopted* — the last one it decided on, whether
  // or not React has committed it yet. State can't answer that (a transition's
  // update isn't visible until it renders), and the reveal reconciliation below
  // must not "correct" a divergence a transition is already converging — that
  // would pre-empt it into a fallback. Written from effects only; a render's own
  // decision is answered by the committed `promise`, so the reconciliation
  // checks both.
  const adoptedRef = useRef(promise);

  const adopt = (next: Promise<LaneRead<T>> | undefined) => {
    adoptedRef.current = next;
    setPromise(next);
  };

  // State, not a ref: a transition that suspends throws its render away, so the
  // retry re-runs the switch branch and re-reads the store. A ref would survive
  // the discarded render and leave the branch already satisfied. `key` rides
  // along so its object identity is replaced only when the source switches.
  const [prevSource, setPrevSource] = useState(() => ({
    enabled,
    hydration: hydrationSource,
    key,
    keyId,
    lane,
  }));

  let effectivePromise = promise;

  // A change in source identity — key, lane, `enabled`, or the publication
  // rendered under — switches the read during render. The hydration dimension
  // carries a republish to readers no notification can reach: a hidden
  // `<Activity>` reader is unsubscribed, but the reveal re-renders it under a
  // new publication and this branch adopts the seed in that same render —
  // inside the revealing transition, so fetch-then-reveal stays one commit
  // with no fallback. Coarseness (any publication in the lineage, not just
  // this key's) costs nothing: a read whose key was not in the payload gets
  // back the promise it already holds and `setPromise` bails out.
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

    // The key object handed to effects changes identity only when the *key*
    // does — not when a republication re-runs this branch for the same key.
    // The subscription is to an entry (by `keyId`), so a republication of the
    // same key must not churn it; a republication carries its new value to a
    // subscribed reader by notification, and to a hidden one by the reveal.
    const nextKey = keyId === prevSource.keyId ? prevSource.key : key;

    setPrevSource({ enabled, hydration: hydrationSource, key: nextKey, keyId, lane });
    setPromise(nextPromise);
  }

  // The reactive form of the key for effects: one object identity per key, so
  // effects re-run when the key changes and stay put across a republication.
  const sourceKey = prevSource.key;

  const onInvalidate = useEffectEvent((
    targetLane: Lane,
    targetKeyId: string,
    targetKey: LaneKey,
    source: LaneInvalidationSource,
  ) => {
    // Only fires while subscribed, which never happens without a loader; the
    // guard narrows `loader` for the read below.
    if (loader === undefined) {
      return;
    }

    const updatePromise = () => {
      adopt(readOrCreate(targetLane, targetKeyId, targetKey, loader, readOptions));
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

    adopt(
      readOrCreate(targetLane, targetKeyId, targetKey, loader, readOptions),
    );
  });

  // An announcement carries no work yet, so the handler is an empty transition:
  // `isPending`'s reset entangles with whatever the announcing scope schedules,
  // which holds this reader pending for the caller's whole action and flips
  // every announced reader in the same tick.
  const onInvalidationPending = useEffectEvent(() => {
    startTransition(() => {});
  });

  // Asked by the store when this reader leaves. An event, not a value, so the
  // subscription never re-opens for an option change — what matters is what
  // the read said last.
  const gcTime = useEffectEvent(() => read.gcTime);

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

  // Focus / reconnect are lane-level events the provider fans out; options are
  // read at fire time, so toggling a flag never re-subscribes.
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
  // promise. The one breach React can create is re-showing a previously
  // committed tree whose effects were torn down in between — an `<Activity>`
  // reveal, or a boundary returning from re-suspension. No render happens
  // there and passive effects flush after paint, so only a layout effect can
  // decide what the first revealed frame shows.
  //
  // Deliberately synchronous, never a transition: a reveal is a new
  // appearance, not the continuation the SWR channel serves. A pending
  // replacement suspends into the boundary's fallback — that is the specified
  // presentation for a new appearance. A replacement the store received as a
  // value (a `set(key, value)`, a publication seed) commits in this same
  // synchronous update, because that promise carries its own settlement (see
  // `instrumentedValue` in core.ts); one that came from a loader suspends until
  // React has stamped it, since a synchronous render has no microtask to wait
  // in. Either way the outdated value never reappears. Reveals that carry a
  // publication don't land here (they adopt during render via the source switch
  // above); this is the net for reveals no signal reached.
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

    // Skip what this reader is showing (`promise`, a render's own committed
    // decision) and what it is already converging to (`adoptedRef`, a
    // transition no render has made visible yet).
    if (nextPromise !== promise && nextPromise !== adoptedRef.current) {
      adopt(nextPromise);
    }
  });

  const subscriptionRef = useRef<LaneReaderSubscription | undefined>(undefined);

  // Reconcile, then subscribe, with nothing between: a store change lands
  // either before the re-read (the reconciliation sees it) or after the
  // subscribe (a notification carries it) — no gap in which a reader could be
  // left rendering an abandoned promise forever. Reconciling first also keeps
  // the reader outside the subscriber set for its own store read, so nothing
  // it starts can arrive as a notification to itself.
  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    // Deliberately a synchronous setState; see the commit-invariant comment
    // above.
    // oxlint-disable-next-line react/react-compiler
    reconcileOnReveal(lane, keyId, sourceKey);

    const open = subscriptionRef.current;

    // A re-suspension re-creates layout effects over a subscription the
    // passive half never closed — don't open a second one. `lane`/`keyId` are
    // enough to recognise it because `sourceKey` (these effects' fourth dep)
    // now holds one identity per key: a republication of the same key does not
    // move it, so these effects do not re-run for one, and the subscription —
    // which is to the entry, by `keyId` — stays put across it.
    if (open && open.lane === lane && open.keyId === keyId) {
      return;
    }

    // Live from here, including for notifications fired from this same
    // commit's layout effects — a sibling that mounted a commit earlier would
    // take them regardless, so deferring to the passive phase would only be
    // inconsistent.
    const close = subscribeLane(lane, keyId, sourceKey, {
      gcTime: () => gcTime(),
      onInvalidationPending: () => {
        onInvalidationPending();
      },
      onInvalidate: (entry, source) => {
        onInvalidate(lane, entry.keyId, entry.key, source);
      },
      onRemove: (entry) => {
        onRemove(lane, entry.keyId, entry.key);
      },
    });

    // oxlint-disable-next-line react/react-compiler
    subscriptionRef.current = { close, keyId, lane };
  }, [enabled, lane, keyId, sourceKey]);

  // The *closing* half — deliberately passive. A re-suspension tears down
  // layout effects but leaves passive ones mounted, so the subscription
  // survives while the fallback is up. Re-hydration depends on that: hidden
  // readers stay subscribed, which is how `LaneHydration`'s macrotask publish
  // reaches them (see hydration.ts).
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const subscription = subscriptionRef.current;

    // Always set — the layout half above shares these deps and has just run.
    // The check is the type's, not a case.
    if (!subscription) {
      return;
    }

    return () => {
      // This instance's own subscription, never whatever the ref holds now: a
      // key switch opens the next one and puts it there before this cleanup.
      subscription.close();

      if (subscriptionRef.current === subscription) {
        // oxlint-disable-next-line react/react-compiler
        subscriptionRef.current = undefined;
      }
    };
  }, [enabled, lane, keyId, sourceKey]);

  useEffect(() => {
    // Handlers read the latest key/options at fire time, so this depends only
    // on being enabled.
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
    (options?: LaneInvalidateOptions): Promise<LaneRead<T>> | undefined => {
      invalidateEntry(lane, keyId, options, invalidationSource(options));

      // The invalidation's fan-out is synchronous, so by this line a
      // subscribed reader's `onInvalidate` has already installed its re-read
      // as the entry's cache — the promise every reader of the key adopts.
      // `undefined` means nothing left to await (gated off, or a stale
      // callback that outlived its subscription).
      return peekEntryPromise(lane, keyId) as
        | Promise<LaneRead<T>>
        | undefined;
    },
    [lane, keyId],
  );

  // Covers only this reader's own transition; other keys join through
  // `lane.startInvalidationTransition(scope)` called inside the action, where
  // the knowledge of what a mutation touches lives.
  const startInvalidationTransition = useCallback(
    (action: () => unknown) => {
      startTransition(async () => {
        await action();
      });
    },
    [],
  );

  return {
    invalidate,
    isBackgroundPending,
    isInvalidationPending,
    promise: effectivePromise,
    startInvalidationTransition,
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
