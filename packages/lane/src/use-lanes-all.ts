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
  // The member's own read, which is also its options. Kept separate from the
  // batch's shared ones rather than merged here: the shared `options` is usually
  // a fresh object literal every render, and every consumer already reads it at
  // render or fire time so a changed value takes effect without re-subscribing.
  options: LaneUseOptions;
  // Never merged with the batch's, because the batch has no `T` to type one
  // against: a shared option set spans members of different types, and this is
  // the one read option that is the member's value. So a batch read falls back
  // exactly as the member defines it, or not at all.
  fallback: LaneFallback<T> | undefined;
};

/**
 * Read a *dynamic* set of `[key, loader]` pairs and get back one stable,
 * `use()`-able `Promise.all` of their values — the batch read for Lane.
 *
 * Each pair is its own keyed read: independently cached, deduped, subscribed
 * (focus / reconnect / `refetchOnMount`), and invalidatable, exactly as if you
 * had called `useLane` for each. `options` are shared by every read, and to
 * leave a read out you omit it from the array — there is no per-item gating.
 *
 * **`reads` must be referentially stable** — memoize it (`useMemo`) or let the
 * React Compiler do it. The hook reacts to `reads` by identity, not by value; a
 * fresh array every render stays correct but does needless work.
 *
 * What `useLanesAll` adds is a *stable* aggregate. `use(Promise.all(...))` built
 * inline re-suspends every render and dead-loops on a rejection (a suspended
 * component never commits, so a component-local cache keeps resetting to a fresh,
 * pending `Promise.all`). `useLanesAll` derives it through a module-level identity
 * cache keyed on the member promises, so the same members always yield the same
 * `Promise.all` — even across uncommitted Suspense retries — and it swaps inside a
 * transition when a member changes, keeping the previous values on screen.
 *
 * `use(promise)` resolves to every read positionally, stays pending until all
 * resolve, and rejects to the Error Boundary if any *initial* load fails.
 *
 * A batch can also be given as specs from `laneRead` — `ids.map(taskLanes.detail)`
 * — which is the shape this hook is most often built from, since the members are
 * derived from a list. A spec carries its own options, so "shared by every read"
 * becomes "the shared `options` is the fallback": a member reads with its own
 * `staleTime` / `refetchOn*` where it defines them, exactly as it would through
 * `useLane`, and inherits the rest from the batch. "Where it defines them" means
 * *with a value* — an option a member leaves `undefined` is unspecified, not an
 * override, so the batch's still applies.
 */
export function useLanesAll<T, C = T>(
  reads: readonly LaneReadSpec<T, C>[],
  options: LaneUseOptions = EMPTY_OPTIONS,
): Promise<LaneRead<T>[]> {
  // One context read; `loaderMeta` comes from the lane, not from a member — see
  // `useLane`.
  const { lane, revalidation, loaderMeta } = useLaneContext("useLanesAll");

  // Serialized once per (stable) `reads`, not every render.
  const descriptors = useMemo(
    () => reads.map<Descriptor<T, C>>(toDescriptor),
    [reads],
  );

  // Flags are not exposed, so a single transition suffices — it just makes member
  // swaps transition-native.
  const [, startTransition] = useTransition();

  // The aggregate lives in state: a member swap sets it (in a transition), an
  // unrelated re-render returns it. Always built through `aggregateOf` (a
  // module-level cache), which keeps it reject-safe — a rejecting mount never
  // commits, so this initializer re-runs on every retry, but `aggregateOf` returns
  // the *same* promise, so `use()` throws the settled rejection once.
  const [aggregate, setAggregate] = useState(() =>
    computeAggregate(lane, descriptors, options, loaderMeta),
  );
  // Rebuild the aggregate during render when the keys change. `builtFrom` is the
  // descriptors the current aggregate reflects — a plain referential guard.
  const [builtFrom, setBuiltFrom] = useState(descriptors);
  let promise = aggregate;
  if (builtFrom !== descriptors) {
    promise = computeAggregate(lane, descriptors, options, loaderMeta);
    setAggregate(promise);
    setBuiltFrom(descriptors);
  }

  // Recompute the whole aggregate from the current members. `readOrCreate` returns
  // the core-cached promise for every unchanged member, so only an invalidated one
  // re-fetches, and `aggregateOf` reuses the identity when members are unchanged.
  const refresh = useEffectEvent((urgent: boolean) => {
    // Only members with no cache re-read — an unchanged member reuses
    // its promise — so handing it to the whole recompute is the same as handing
    // it to the member that was just invalidated.
    const apply = () =>
      setAggregate(computeAggregate(lane, descriptors, options, loaderMeta));
    if (urgent) {
      apply();
      return;
    }
    startTransition(apply);
  });

  // Mount / focus / reconnect derive their conditional invalidation from the
  // trigger + latest options at fire time (`revalidateOptions` returns
  // `undefined` when the trigger is off), so toggling a flag never re-subscribes.
  // Each fans the invalidation across the current keys; overlaps coalesce in the
  // store, so the smallest effective `staleTime` wins.
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

  // An event for the same reason every option here is one: the subscribing
  // effect cannot read `options` directly without re-subscribing on every
  // render that rebuilds the literal.
  const gcTimeOf = useEffectEvent(
    (descriptor: Descriptor<T, C>) => optionsFor(options, descriptor).gcTime,
  );

  // The one imperative bit: keyId → unsubscribe. The effect reconciles the live
  // subscriptions to the current keys — dropping departed keys and subscribing
  // newly present ones (firing their mount refetch). Subscriptions are pure
  // notify hooks, so option changes never touch this. Passive, not layout, for
  // the reason spelled out in `use-lane.ts`: a hidden-for-fallback batch has to
  // stay subscribed.
  const subsRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    const active = subsRef.current;

    // Keyed by keyId, holding the member that answers for it: the key to
    // subscribe with, and the `gcTime` the subscription carries.
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
      // How long this key's value is worth keeping once the batch stops
      // holding it, from the member subscribing for it. Duplicate keys in one
      // batch are rare enough that reconciling their options would cost more
      // than it could be worth: the first one answers.
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

    // The mount refetch is fired per *member* of a newly subscribed key rather
    // than per key, because with specs the trigger is a member's own option and
    // duplicate keys share one subscription. Overlapping invalidations coalesce
    // in the store, so the smallest effective staleTime still wins.
    for (const descriptor of descriptors) {
      if (added.has(descriptor.keyId)) {
        mountRefetch(descriptor);
      }
    }

    // Catch up on invalidations that landed before a newly-added key subscribed
    // (common while an initial read keeps the batch suspended).
    if (added.size > 0) {
      refresh(false);
    }
  }, [descriptors, lane]);

  // Register focus / reconnect with the provider once; the handlers read the
  // latest keys and options, so adding a read or toggling a flag needs no
  // re-registration.
  useEffect(
    () =>
      revalidation.subscribe({
        onFocus: revalidateOnFocus,
        onReconnect: revalidateOnReconnect,
      }),
    [revalidation],
  );

  // Unsubscribe everything on unmount.
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
 * The options one member is read with: its own where it defines them, the
 * batch's shared ones for the rest. With no shared options — the common case,
 * since a member usually carries its own — the member's read *is* the answer, so
 * the merge is skipped rather than allocating a copy per member per recompute.
 *
 * Resolved option by option with `??` rather than by spreading the member over
 * the batch. The two differ on exactly one input, and it is one a caller writes by
 * accident: a member that carries an *explicit* `undefined` — `staleTime:
 * props.staleTime` where the prop is optional, which `strict` alone does not flag.
 * A spread lets that shadow the batch's value and drop the member to the built-in;
 * `??` treats it as unspecified, which is what `undefined` means everywhere else in
 * Lane (the read path resolves `options?.staleTime ?? 0`, an absent loader gates a
 * read off, an absent trigger is off). This is the only place in the library with
 * two tiers to disagree about, so it is the only place the distinction was ever
 * observable — and the reason to spend six `??` here is that it keeps the rule
 * sayable once for all of Lane.
 *
 * Naming them also drops `key` / `loader` from the result, which a spread of the
 * member's read carried along inert. Nothing reads them off these options:
 * `computeAggregate` takes both from the descriptor.
 *
 * The cost of naming them is that a new option must be added here too, or a
 * member's value is silently dropped whenever the batch passes any options at
 * all. `loaderMeta` is the first one added since, and the test for a member
 * overriding the batch's meta is what would catch the omission.
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

// Fire a background revalidation across every current member for a focus /
// reconnect trigger, skipping the members whose own trigger is off.
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
 * Identity-stable `Promise.all` for a sequence of member promises, memoized in a
 * module-level trie keyed on the ordered member identities. The same sequence
 * always yields the same `Promise.all` — even from a fresh (uncommitted) render,
 * which is what a rejecting mount needs to reach the Error Boundary instead of
 * re-suspending forever. `WeakMap`s key on the promises, so nodes are reclaimed
 * once their promises are GC'd.
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
