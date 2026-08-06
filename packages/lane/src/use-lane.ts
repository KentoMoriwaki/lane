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
import type { LaneInvalidationSource } from "./core";
import { LaneHydrationSourceContext } from "./hydration";
import { serializeKey } from "./keys";
import { isExternalLoader } from "./ownership";
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
 * A reader's subscription, opened in the layout phase of a commit and closed in
 * the passive phase of the one that ends it. The two halves live in different
 * effects, so the handle is what carries one to the other; `lane` and `keyId`
 * are what let the opening half recognise a subscription it already owns.
 *
 * The asymmetry is the design, and each half is argued at its own site below.
 * Opening in the layout phase puts the subscription immediately after the
 * reconciliation that reads the store, with nothing between them, so no store
 * change can reach neither channel. Closing in the passive phase keeps the
 * subscription alive across a re-suspension, which tears down layout effects and
 * leaves passive ones mounted.
 */
type LaneReaderSubscription = {
  close: () => void;
  keyId: string;
  lane: Lane;
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
  // Whose value this key holds, as the read declares it. The store asks the same
  // question of the loader it is handed (`readOrCreate`); this asks it one level
  // up, to decide whether publications are part of this read's source at all.
  // Nothing else here branches on it — every read path below is still one
  // unconditional `readOrCreate`.
  const external = isExternalLoader(loader);
  const keyId = serializeKey(key);
  const readOptions = toReadOptions(read, loaderMeta);
  const [isInvalidationPending, startTransition] = useTransition();
  const [isBackgroundPending, startBackgroundTransition] = useTransition();
  // The publication this render is happening under (nearest LaneHydration
  // boundary, or the stable `undefined` outside one). Part of the read's
  // source: a republish is a new source the same way a new key is.
  //
  // **Read only by an external read**, and with `use` rather than `useContext`
  // because that is the form React allows to be called conditionally. The
  // condition is the whole point: a context a render did not read is not a
  // dependency of that fiber, so a client-owned read is not a consumer of the
  // lineage and a publication does not re-render it at all.
  //
  // That is the right scope, because a publication is the arrival of a value the
  // key's *owner* supplies, and a read carrying a client loader has declared that
  // it supplies its own. Its convergence channels are the ones every client read
  // has: the notification while it is subscribed, and the reveal reconciliation
  // while it is not (`publishEntry` notifies either way, so a *visible*
  // client-owned reader of a seeded key still converges — it just does so through
  // the channel it shares with `set`, rather than through the lineage).
  //
  // Widening it costs more than a wasted render, which is why the narrowing is
  // not merely an optimization. A re-read is only a no-op while the entry still
  // holds what the reader is showing, and for an *unsubscribed* reader — a hidden
  // `<Activity>`, the population this dimension exists for — it may not:
  // `whenStale: "refetch"` discards a stale value that no longer has a subscriber
  // to protect it, and an entry the sweep already evicted is re-created by the
  // read-through. Both start, from an unrelated boundary's republish, work that
  // belonged to the reader's own reveal.
  const hydrationSource = external
    ? use(LaneHydrationSourceContext)
    : undefined;
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
  // the retry would commit the *previous* key's promise and wait for a
  // notification on the new key to repair it.
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
  // with no fallback.
  //
  // That dimension is `undefined` on both sides for a client-owned read (see the
  // context read above), so it is inert for one — the branch narrows to the three
  // dimensions such a read actually has. It is *not* inert across a read that
  // changes ownership: a spec that swaps a client loader for `external` under a
  // boundary reads a lineage where it recorded none, which is a source change and
  // is re-read as one.
  //
  // Among external reads it stays deliberately coarse — any publication in the
  // lineage, not just one carrying this key. That costs a re-read and no more:
  // an external spec has no `staleTime` / `whenStale` to make `reuseCache`
  // discard anything, and the reader holds the very promise the entry's weak slot
  // points at, so a read whose key was not in the payload returns the promise it
  // already has and the `setPromise` below bails out.
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
  ) => {
    // Only fires while subscribed, which never happens without a loader; the
    // guard also narrows `loader` to non-undefined for the read below.
    if (loader === undefined) {
      return;
    }

    const updatePromise = () => {
      setPromise(
        readOrCreate(targetLane, targetKeyId, targetKey, loader, readOptions),
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

  // An announcement carries no work: the caller has not changed the source yet,
  // so there is nothing to re-read and nothing to store. Opening the transition
  // with an empty scope is the entire handler — `isPending` is itself
  // transition-lane state, so its reset entangles with whatever else the
  // announcing scope schedules and cannot commit before that scope does. That is
  // what holds this reader pending for the caller's whole action, and what makes
  // every reader in the announced scope flip in the same tick.
  const onInvalidationPending = useEffectEvent(() => {
    startTransition(() => {});
  });

  // The one piece of policy the subscription carries, and the store asks for it
  // at the moment this reader leaves: how long its value is worth keeping once
  // nothing holds it. An event rather than a value on the subscriber object,
  // because options are re-read every render and the subscription is not
  // re-opened for them — what matters is what the read said last.
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

  // Both halves of the subscription depend on — and hand the events — the read's
  // full identity: `lane`, the canonical `keyId`, and `sourceKey`, whose object
  // identity follows it. The events exist only for what must *not* be reactive
  // here (`promise`, `loader`, `readOptions`).
  const subscriptionRef = useRef<LaneReaderSubscription | undefined>(undefined);

  // The reconciliation and the *opening* half of the subscription, in that order
  // and with nothing between them. That adjacency is the point: renders re-read
  // the store on every attempt (initializer, source switch), this reconciles
  // once more inside the commit, and the subscription starts in the same
  // synchronous breath — so a store change lands either before the re-read,
  // where the reconciliation sees it, or after the subscribe, where a
  // notification carries it. There is no third place. A visible reader that fell
  // into one would have no re-appearance coming to repair it, so however narrow
  // the window, the failure mode it removes is rendering an abandoned promise
  // forever.
  //
  // Reconciling first is what keeps the two from overlapping: the store read
  // that decides the first revealed frame happens while this reader is still
  // outside the subscriber set, so nothing it starts there can arrive as a
  // notification to itself.
  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    // Deliberately a synchronous setState; see the commit-invariant comment
    // above.
    // oxlint-disable-next-line react/react-compiler
    reconcileOnReveal(lane, keyId, sourceKey);

    const open = subscriptionRef.current;

    // A re-suspension re-creates layout effects over a subscription the passive
    // half never closed. Same lane, same key, still in the store's subscriber
    // set: there is nothing to open, and opening a second one would leave the
    // first with nobody holding its close.
    if (open && open.lane === lane && open.keyId === keyId) {
      return;
    }

    // Live from here, including for a notification that lands while React is
    // still flushing this commit's layout effects. Neither of the two updates a
    // notification schedules changes priority with the phase it is scheduled
    // from: the pending flag is an optimistic update React pins to the sync lane
    // and entangles with the transition through its revert lane, and the promise
    // rides that transition. All the phase decides is *when* that sync work
    // flushes — before this commit's paint rather than after the next one — and
    // an `invalidate` fired from a layout effect is a deliberate choice of phase
    // by its caller. Holding it back until this reader's own passive effect
    // would defer it to a phase nobody asked for, and would not even be
    // consistent: a sibling of this key that mounted a commit earlier is already
    // live and takes the same notification here regardless.
    //
    // The subscription is plainly reactive — `sourceKey` is the key object
    // whose identity is the source's — so it lives in the effect, not behind an
    // event: anything new it comes to read is forced into the deps.
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

  // The *closing* half, and nothing else — deliberately passive. A boundary that
  // re-suspends hides the subtree it had already committed and tears down its
  // layout effects while leaving passive ones mounted, so a subscription closed
  // from here survives for as long as the fallback is up. Re-hydration is built
  // on exactly that: `LaneHydration` suspends and publishes from a macrotask
  // rather than from an effect (see `hydration.ts`), which reaches
  // already-mounted readers only because hiding them did not unsubscribe them.
  // Closing from the layout half would silently sever that.
  //
  // So the pair is asymmetric on purpose: opening early is what makes the
  // notification channel complete, closing late is what keeps it alive through a
  // fallback, and this effect exists for the cleanup alone.
  useEffect(() => {
    // A disabled read owns no entry: no subscription, no GC anchor, no
    // revalidation. Both halves re-run when `enabled` flips and subscribe then.
    // The subscription is pure notify + GC; option changes never re-run it.
    if (!enabled) {
      return;
    }

    const subscription = subscriptionRef.current;

    // Always there — layout effects run before passive ones in the same commit
    // and these two carry the same deps, so the half above has just written it.
    // The check is the type's, not a case.
    if (!subscription) {
      return;
    }

    return () => {
      subscription.close();

      // Only if it is still the current one. A source switch runs the opening
      // half for the *new* key before this cleanup runs for the old one, so the
      // handle is captured rather than re-read, and the ref is left alone unless
      // this is the subscription it still names.
      if (subscriptionRef.current === subscription) {
        // oxlint-disable-next-line react/react-compiler
        subscriptionRef.current = undefined;
      }
    };
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
    (options?: LaneInvalidateOptions): Promise<LaneRead<T>> | undefined => {
      invalidateEntry(lane, keyId, options, invalidationSource(options));

      // The next read, from the store rather than from a loader this callback
      // would have to depend on. The invalidation's fan-out is synchronous, so
      // by this line a subscribed reader's `onInvalidate` has already
      // installed its re-read as the entry's cache — the promise every reader
      // of the key adopts, by the store's dedupe — and an `onlyIf` that
      // declined cleared nothing, so the cache it left in place *is* "the
      // key's value after this call". `undefined` is the read with nothing
      // left to await: gated off, or a stale callback that outlived its
      // subscription.
      return peekEntryPromise(lane, keyId) as
        | Promise<LaneRead<T>>
        | undefined;
    },
    [lane, keyId],
  );

  // Only this reader's own transition, which needs no announcement:
  // `startTransition` here *is* what `isInvalidationPending` reports. Other keys
  // join through `lane.startInvalidationTransition(scope)`, called inside the
  // action — which is where the knowledge of what a mutation touches lives, and
  // where it composes: a helper announces its own reach without its caller
  // having to enumerate it.
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
