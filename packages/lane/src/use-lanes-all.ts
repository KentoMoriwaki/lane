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
import { serializeKey } from "./keys";
import { useLaneInstance, useLaneRevalidation } from "./provider";
import { revalidateOptions, toReadOptions } from "./read-options";
import type {
  Lane,
  LaneKey,
  LaneLoader,
  LaneRead,
  LaneReadSpec,
  LaneUseOptions,
} from "./types";

const EMPTY_OPTIONS: LaneUseOptions = {};

function noop(): void {}

/** One member of a batch, in either form the hook accepts. */
type BatchRead<T, C> = readonly [LaneKey, LaneLoader<T>] | LaneReadSpec<T, C>;

type Descriptor<T> = {
  key: LaneKey;
  keyId: string;
  // C-erased: the batch is typed by `T` alone, and its two member forms disagree
  // about `C` (a tuple's loader is `LaneLoader<T, T>`, a spec's is whatever it
  // was defined with). Every loader accepts a context that promises nothing
  // about `current`, so `never` is the one type both forms fit — and `current`
  // itself still reaches the loader body with the type it was written against.
  loader: LaneLoader<T, never>;
  // The member's own options, when it came from a spec. Kept separate from the
  // shared ones rather than merged here: the shared `options` is usually a fresh
  // object literal every render, and every consumer already reads it at render
  // or fire time so a changed value takes effect without re-subscribing.
  options: LaneUseOptions | undefined;
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
 * `useLane`, and inherits the rest from the batch.
 */
export function useLanesAll<T>(
  reads: readonly (readonly [LaneKey, LaneLoader<T>])[],
  options?: LaneUseOptions,
): Promise<LaneRead<T>[]>;
export function useLanesAll<T, C = T>(
  reads: readonly LaneReadSpec<T, C>[],
  options?: LaneUseOptions,
): Promise<LaneRead<T>[]>;
export function useLanesAll<T, C = T>(
  reads: readonly BatchRead<T, C>[],
  options: LaneUseOptions = EMPTY_OPTIONS,
): Promise<LaneRead<T>[]> {
  const lane = useLaneInstance();
  const revalidation = useLaneRevalidation();

  // Serialized once per (stable) `reads`, not every render.
  const descriptors = useMemo(
    () => reads.map<Descriptor<T>>(toDescriptor),
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
    computeAggregate(lane, descriptors, options),
  );
  // Rebuild the aggregate during render when the keys change. `builtFrom` is the
  // descriptors the current aggregate reflects — a plain referential guard.
  const [builtFrom, setBuiltFrom] = useState(descriptors);
  let promise = aggregate;
  if (builtFrom !== descriptors) {
    promise = computeAggregate(lane, descriptors, options);
    setAggregate(promise);
    setBuiltFrom(descriptors);
  }

  // Recompute the whole aggregate from the current members. `readOrCreate` returns
  // the core-cached promise for every unchanged member, so only an invalidated one
  // re-fetches, and `aggregateOf` reuses the identity when members are unchanged.
  const refresh = useEffectEvent((urgent: boolean, gate?: Promise<void>) => {
    // The gate only reaches members with no cache — an unchanged member reuses
    // its promise — so handing it to the whole recompute is the same as handing
    // it to the member that was just invalidated.
    const apply = () =>
      setAggregate(computeAggregate(lane, descriptors, options, gate));
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
  const mountRefetch = useEffectEvent((descriptor: Descriptor<T>) => {
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

  // The one imperative bit: keyId → unsubscribe. The effect reconciles the live
  // subscriptions to the current keys — dropping departed keys and subscribing
  // newly present ones (firing their mount refetch). Subscriptions are pure
  // notify hooks, so option changes never touch this.
  const subsRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    const active = subsRef.current;

    const wanted = new Map<string, LaneKey>();
    for (const { key, keyId } of descriptors) {
      if (!wanted.has(keyId)) {
        wanted.set(keyId, key);
      }
    }

    for (const [keyId, unsub] of active) {
      if (!wanted.has(keyId)) {
        unsub();
        active.delete(keyId);
      }
    }

    const added = new Set<string>();
    for (const [keyId, key] of wanted) {
      if (active.has(keyId)) {
        continue;
      }
      added.add(keyId);
      active.set(
        keyId,
        subscribeLane(lane, key, {
          onInvalidate: (_entry, _source, gate) => refresh(false, gate),
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

function toDescriptor<T, C>(read: BatchRead<T, C>): Descriptor<T> {
  // A tuple member is an array and a spec never is — the same structural test
  // that tells a key from a spec everywhere else in Lane.
  if (Array.isArray(read)) {
    const [key, loader] = read as readonly [LaneKey, LaneLoader<T>];
    return { key, keyId: serializeKey(key), loader, options: undefined };
  }

  const spec = read as LaneReadSpec<T, C>;
  return {
    key: spec.key,
    keyId: serializeKey(spec.key),
    loader: spec.loader,
    options: spec,
  };
}

/**
 * The options one member is read with: its own where it defines them, the
 * batch's shared ones for the rest. A tuple member has none of its own, so it
 * gets the shared object unchanged — the common case allocates nothing.
 */
function optionsFor<T>(
  shared: LaneUseOptions,
  descriptor: Descriptor<T>,
): LaneUseOptions {
  return descriptor.options ? { ...shared, ...descriptor.options } : shared;
}

function computeAggregate<T>(
  lane: Lane,
  descriptors: Descriptor<T>[],
  options: LaneUseOptions,
  gate?: Promise<void>,
): Promise<LaneRead<T>[]> {
  return aggregateOf(
    descriptors.map((d) =>
      readOrCreate(
        lane,
        d.key,
        d.loader,
        toReadOptions(optionsFor(options, d)),
        gate,
      ),
    ),
  );
}

// Fire a background revalidation across every current member for a focus /
// reconnect trigger, skipping the members whose own trigger is off.
function revalidateAll<T>(
  lane: Lane,
  descriptors: Descriptor<T>[],
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
