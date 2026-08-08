"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { invalidateEntry, readOrCreate, subscribeLane } from "./core";
import type { LaneReadOptions } from "./core";
import { serializeKey } from "./keys";
import { useLaneContext } from "./provider";
import { revalidateOptions, toReadOptions } from "./read-options";
import type {
  Lane,
  LaneFallback,
  LaneKey,
  LaneLoader,
  LaneLoaderMeta,
  LaneRead,
  LaneReadSpec,
  LaneUseOptions,
} from "./types";

const EMPTY_OPTIONS: LaneUseOptions = {};

function noop(): void {}

type Descriptor<T, C> = {
  key: LaneKey;
  keyId: string;
  loader: LaneLoader<T, C>;
  // Merged with the batch's shared options at fire time, not here, so a
  // rebuilt shared object takes effect without re-subscribing.
  options: LaneUseOptions;
  // Never merged: shared options have no `T` to type a fallback against.
  fallback: LaneFallback<T> | undefined;
};

/**
 * Read a dynamic set of reads (e.g. `ids.map(taskLanes.detail)`) as one stable,
 * `use()`-able `Promise.all`. Each member is its own keyed read — cached,
 * deduped, subscribed, invalidatable — exactly as through `useLane`. A member's
 * own options win per option; the batch's shared `options` fill in the rest (an
 * `undefined` member option is unspecified, not an override). **`reads` must be
 * referentially stable** — memoize it; the hook reacts to it by identity, and a
 * fresh array each render stays correct but does needless work.
 *
 * The aggregate must be identity-stable: an inline `use(Promise.all(...))`
 * re-suspends every render and dead-loops on rejection (a suspended component
 * never commits, so a local cache resets on every retry). It is derived from a
 * module-level cache keyed on the member promises and swapped inside a
 * transition, keeping previous values on screen. `use(promise)` resolves
 * positionally and rejects to the Error Boundary if any *initial* load fails.
 */
export function useLanesAll<T, C = T>(
  reads: readonly LaneReadSpec<T, C>[],
  options: LaneUseOptions = EMPTY_OPTIONS,
): Promise<LaneRead<T>[]> {
  // `loaderMeta` comes from the lane, not from a member — see `useLane`.
  const { lane, revalidation, loaderMeta } = useLaneContext("useLanesAll");

  const descriptors = useMemo(
    () => reads.map<Descriptor<T, C>>(toDescriptor),
    [reads],
  );

  const [, startTransition] = useTransition();

  // A rejecting mount never commits, so this initializer re-runs each retry —
  // but `aggregateOf` returns the same promise, so `use()` throws the rejection.
  const [aggregate, setAggregate] = useState(() =>
    computeAggregate(lane, descriptors, options, loaderMeta),
  );
  // Rebuild during render when descriptors change; `builtFrom` is the guard.
  const [builtFrom, setBuiltFrom] = useState(descriptors);
  let promise = aggregate;
  if (builtFrom !== descriptors) {
    promise = computeAggregate(lane, descriptors, options, loaderMeta);
    setAggregate(promise);
    setBuiltFrom(descriptors);
  }

  // Only invalidated members re-fetch: `readOrCreate` reuses cached promises.
  const refresh = useEffectEvent((urgent: boolean) => {
    const apply = () =>
      setAggregate(computeAggregate(lane, descriptors, options, loaderMeta));
    if (urgent) {
      apply();
      return;
    }
    startTransition(apply);
  });

  // Triggers read the latest options at fire time, so toggling a flag never
  // re-subscribes. Overlaps coalesce in the store: smallest `staleTime` wins.
  const mountRefetch = useEffectEvent((descriptor: Descriptor<T, C>) => {
    const own = optionsFor(options, descriptor);
    const invalidateOptions = revalidateOptions(
      own.refetchOnMount,
      own.staleTime,
    );
    if (invalidateOptions) {
      invalidateEntry(lane, descriptor.keyId, invalidateOptions, "background");
    }
  });

  const revalidateOnFocus = useEffectEvent(() => {
    revalidateAll(lane, descriptors, options, "refetchOnFocus");
  });

  const revalidateOnReconnect = useEffectEvent(() => {
    revalidateAll(lane, descriptors, options, "refetchOnReconnect");
  });

  // An event so the subscribing effect need not depend on `options`.
  const gcTimeOf = useEffectEvent(
    (descriptor: Descriptor<T, C>) => optionsFor(options, descriptor).gcTime,
  );

  // Reconcile subscriptions (keyId → unsubscribe) to the current keys. Passive,
  // not layout: a fallback-hidden batch must stay subscribed (see use-lane.ts).
  const subsRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    const active = subsRef.current;

    const wanted = new Map<string, Descriptor<T, C>>();
    for (const descriptor of descriptors) {
      if (!wanted.has(descriptor.keyId)) {
        wanted.set(descriptor.keyId, descriptor);
      }
    }

    for (const [keyId, unsub] of active) {
      if (!wanted.has(keyId)) {
        unsub();
        active.delete(keyId);
      }
    }

    const added = new Set<string>();
    for (const [keyId, descriptor] of wanted) {
      if (active.has(keyId)) {
        continue;
      }
      added.add(keyId);
      // Duplicate keys in one batch: the first member answers for `gcTime`.
      const gcTime = gcTimeOf(descriptor);
      active.set(
        keyId,
        subscribeLane(lane, keyId, descriptor.key, {
          gcTime: () => gcTime,
          onInvalidate: () => refresh(false),
          onRemove: () => refresh(true),
        }),
      );
    }

    // Per *member*, not per key: the trigger is a member's own option while
    // duplicate keys share one subscription.
    for (const descriptor of descriptors) {
      if (added.has(descriptor.keyId)) {
        mountRefetch(descriptor);
      }
    }

    // Catch up on invalidations that landed before a new key subscribed
    // (e.g. while an initial read kept the batch suspended).
    if (added.size > 0) {
      refresh(false);
    }
  }, [descriptors, lane]);

  // Registered once; handlers read the latest keys and options at fire time.
  useEffect(
    () =>
      revalidation.subscribe({
        onFocus: revalidateOnFocus,
        onReconnect: revalidateOnReconnect,
      }),
    [revalidation],
  );

  useEffect(
    () => () => {
      for (const unsub of subsRef.current.values()) {
        unsub();
      }
      subsRef.current.clear();
    },
    [],
  );

  return promise;
}

function toDescriptor<T, C>(read: LaneReadSpec<T, C>): Descriptor<T, C> {
  return {
    key: read.key,
    keyId: serializeKey(read.key),
    loader: read.loader,
    options: read,
    fallback: read.fallback,
  };
}

/**
 * A member's effective options: its own where defined, the batch's otherwise
 * (returned as-is when the batch passes none). Resolved with `??` per option,
 * not a spread: an accidental *explicit* `undefined` on a member must fall back
 * to the batch, not shadow it — `undefined` means unspecified everywhere in
 * Lane. Every new `LaneUseOptions` field must be added here, or a member's
 * value is silently dropped whenever the batch passes any options.
 */
function optionsFor<T, C>(
  shared: LaneUseOptions,
  descriptor: Descriptor<T, C>,
): LaneUseOptions {
  const own = descriptor.options;

  if (shared === EMPTY_OPTIONS) {
    return own;
  }

  return {
    loaderMeta: own.loaderMeta ?? shared.loaderMeta,
    refetchOnFocus: own.refetchOnFocus ?? shared.refetchOnFocus,
    refetchOnMount: own.refetchOnMount ?? shared.refetchOnMount,
    refetchOnReconnect: own.refetchOnReconnect ?? shared.refetchOnReconnect,
    staleTime: own.staleTime ?? shared.staleTime,
    gcTime: own.gcTime ?? shared.gcTime,
    warmTime: own.warmTime ?? shared.warmTime,
  };
}

function computeAggregate<T, C>(
  lane: Lane,
  descriptors: Descriptor<T, C>[],
  options: LaneUseOptions,
  loaderMeta: LaneLoaderMeta,
): Promise<LaneRead<T>[]> {
  return aggregateOf(
    descriptors.map((d) =>
      readOrCreate(
        lane,
        d.keyId,
        d.key,
        d.loader,
        toReadOptions(
          optionsFor(options, d),
          loaderMeta,
          d.fallback as LaneReadOptions["fallback"],
        ),
      ),
    ),
  );
}

// Focus / reconnect: background-revalidate every member whose own trigger is on.
function revalidateAll<T, C>(
  lane: Lane,
  descriptors: Descriptor<T, C>[],
  shared: LaneUseOptions,
  trigger: "refetchOnFocus" | "refetchOnReconnect",
): void {
  for (const descriptor of descriptors) {
    const options = optionsFor(shared, descriptor);
    const invalidateOptions = revalidateOptions(
      options[trigger],
      options.staleTime,
    );

    if (invalidateOptions) {
      invalidateEntry(lane, descriptor.keyId, invalidateOptions, "background");
    }
  }
}

/**
 * Identity-stable `Promise.all`, memoized in a module-level trie of `WeakMap`s
 * keyed on the ordered member promises (nodes free with their promises): the
 * same sequence yields the same promise even from an uncommitted render, which
 * a rejecting mount needs to reach the Error Boundary instead of re-suspending.
 */
type AggregateNode = {
  value: Promise<unknown> | undefined;
  children: WeakMap<object, AggregateNode>;
};

const aggregateRoot: AggregateNode = { children: new WeakMap(), value: undefined };

function aggregateOf<T>(ordered: Promise<LaneRead<T>>[]): Promise<LaneRead<T>[]> {
  let node = aggregateRoot;
  for (const member of ordered) {
    let child = node.children.get(member);
    if (!child) {
      child = { children: new WeakMap(), value: undefined };
      node.children.set(member, child);
    }
    node = child;
  }

  if (node.value === undefined) {
    const value = Promise.all(ordered);
    value.catch(noop);
    node.value = value;
  }

  return node.value as Promise<LaneRead<T>[]>;
}
