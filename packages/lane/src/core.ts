import { isPrefixKey, serializeKey } from "./keys";
import {
  isExternalLoader,
  LaneOwnershipError,
  publicationReason,
} from "./ownership";
import { LaneReadError } from "./read-error";
import { replaceEqualDeep } from "./structural";
import type {
  Lane,
  LaneEntryInfo,
  LaneInvalidateOptions,
  LaneKey,
  LaneLoader,
  LaneLoaderMeta,
  LaneLoaderMetaArgs,
  LaneOptions,
  LaneRead,
  LaneReadSpec,
  LaneScope,
  LaneUpdater,
  LaneValue,
} from "./types";

export type LaneInvalidationSource = "background" | "transition";

/**
 * What the store needs from a read: only what the loader needs — `staleTime`
 * and `gcTime` describe a reader and deliberately never reach the read path.
 */
export type LaneReadOptions = {
  /** How long the settled value waits for its first reader, from settlement. */
  warmTime?: number;
  /** Failure policy — the starting read's {@link LaneFallback}, erased to `unknown`. */
  fallback?: (context: {
    error: unknown;
    key: LaneKey;
    lastFulfilled: unknown;
  }) => unknown;
  /** The lane's `loaderMeta`, passed as `context.meta`; never affects cache reuse. */
  loaderMeta?: LaneLoaderMeta;
  /**
   * What a publication becomes when it lands on a value this read already
   * holds — see {@link LaneMergePublication}. Travels with the read like
   * `fallback` does, but is kept on the entry: the publication arrives from
   * somewhere else entirely, so the policy has to be there when it does.
   */
  merge?: LaneMergePublication;
};

/**
 * A read's policy for a publication landing on an entry that already holds a
 * fulfilled value: return what the entry should store. `useInfiniteLane` is
 * what it exists for — a list whose first page is the route's and whose depth
 * is the browser's has to survive a republication of page 1 — and it is the
 * only policy Lane ships.
 *
 * Never called with nothing to merge into: "the entry holds a fulfilled value"
 * is the store's question, decided synchronously at publication time, and the
 * publication is stored verbatim when the answer is no. What counts as "the
 * same value" is the read's question, which is why the policy is the read's.
 */
export type LaneMergePublication = (context: {
  /** The value the owner just published. */
  published: unknown;
  /** What the entry holds right now — settled, and known so synchronously. */
  held: unknown;
  key: LaneKey;
}) => unknown;

type LaneSubscription = (
  entry: LaneEntryInfo,
  source: LaneInvalidationSource,
) => void;

type LaneRemoveSubscription = (entry: LaneEntryInfo) => void;

/**
 * "An invalidation is coming for your key — open its transition now." Nothing
 * to re-read: `useLane`'s whole handler is an empty `startTransition` that
 * raises `isInvalidationPending`.
 */
type LaneInvalidationPendingSubscription = (entry: LaneEntryInfo) => void;

// A subscriber is a notify hook plus a GC anchor — no revalidation policy.
// Focus / reconnect / mount triggers are the reader's and provider's concern.
export type LaneSubscriber = {
  onInvalidate?: LaneSubscription;
  onInvalidationPending?: LaneInvalidationPendingSubscription;
  onRemove?: LaneRemoveSubscription;
  /**
   * This reader's `gcTime`, read as it leaves (the only reader left to ask). A
   * function: options are re-read every render without re-subscribing.
   */
  gcTime?: () => number | undefined;
};

type LaneState = {
  entries: Map<string, LaneEntry>;
  gcTime: number;
  warmTime: number;
  sweepTimer: ReturnType<typeof setTimeout> | undefined;
  /** When {@link sweepTimer} is due, so a nearer deadline can replace it. */
  sweepAt: number | undefined;
  /**
   * Mints {@link LaneEntry.revision}; lane-wide so a re-created entry never
   * re-issues a number an older generation of the same key used.
   */
  revisionCounter: number;
  /**
   * The owner-ask: what the app supplies so Lane can say "render again"
   * (`() => router.refresh()`, `() => revalidator.revalidate()`). Lane-level
   * because the ask is, and re-assignable because `<LaneProvider refresh>`
   * installs it on the lane it holds.
   */
  refresh: (() => void) | undefined;
  /** An ask is already scheduled for this tick — see {@link askOwner}. */
  refreshScheduled: boolean;
  /**
   * The next look at whether anyone is still waiting — see
   * {@link scheduleReask}. One per lane; absent when nothing was asked for.
   */
  reaskTimer: ReturnType<typeof setTimeout> | undefined;
};

type LanePromiseSettlement = {
  at: number;
  kind: "fulfilled" | "rejected";
};

/**
 * A promise carrying its own settlement, as React's promise cache protocol
 * describes it (react.dev, `use` → "How to implement a promise cache"). The
 * field names are the protocol; nothing else reads them, and none of this
 * widens a public type — what Lane hands out is still a `Promise<LaneRead<T>>`.
 */
type LaneThenable<T> = Promise<T> & {
  /**
   * Lane only ever writes `"fulfilled"` (it stamps values it was handed, which
   * are settled by definition); React writes the other two on any promise a
   * reader has `use()`d, and this type is also how those are read back.
   */
  status?: "fulfilled" | "pending" | "rejected";
  value?: T;
};

type LanePromiseCache = {
  /**
   * The promise for a client-owned entry; a weak reference for an external one
   * (see {@link cacheSlot}). `entry.external` says how to read the slot;
   * `markExternal` converts an existing slot, so the two cannot disagree.
   */
  promise: Promise<unknown> | LaneWeakSlot<Promise<unknown>>;
  settlement: LanePromiseSettlement | undefined;
  startedAt: number;
  controller: AbortController | undefined;
  /**
   * This cache is an external read's wait for its owner, not a value being
   * installed — so an unsettled one means "nobody has answered yet", which is
   * what {@link askOwner} asks about. A `set(key, promise)` on the same entry
   * is a write in flight and answers for itself.
   */
  waiting: boolean;
  // Set by `cancel` on an in-flight read; the cache stays, so its settlement
  // handlers read this and fold into the fallback — a loader that ignores its
  // `signal` cannot undo a cancel.
  cancelled: boolean;
};

type LaneEntry = {
  key: LaneKey;
  keyId: string;
  cache: LanePromiseCache | undefined;
  subscribers: Set<LaneSubscriber>;
  lastFulfilled: { value: unknown; at: number } | undefined;
  /**
   * Idle-eviction deadline; cleared while subscribed. `undefined` = held (the
   * only state the sweep skips); `Infinity` = idle but kept anyway.
   */
  evictAt: number | undefined;
  /**
   * Identity of the held content — advanced only when a fulfillment is a new
   * reference (deep-equal refetches keep the old revision); external entries
   * advance on every publication (see {@link rememberFulfilled}). `0` until
   * the first fulfillment.
   */
  revision: number;
  /**
   * Value comes from outside: read with `external`, or seeded by a publication
   * (`hydrate.ts`). An ordinary entry otherwise — the client writes to it like
   * any other — except that retention is by reachability, not `gcTime`.
   * One-way for the shell's lifetime.
   */
  external: boolean;
  /**
   * An owner has filled this key at least once. It is what separates "waiting
   * for the first publication" (streaming SSR, a reader outside every
   * `<LaneHydration>` boundary — nothing to ask for, the payload is already on
   * its way) from "the value this key had is gone" (invalidated, removed,
   * collected), which is the only state {@link askOwner} asks in. Survives
   * `invalidate` / `remove` and the loss of the value itself: that an owner
   * fills this key is a fact about the key, not about the value.
   */
  published: boolean;
  /**
   * Where in the last publication's bucket of promises this entry sits — the
   * seat a client write takes, so that the write lives exactly as long as the
   * publication it overwrote. Held weakly, because the bucket is alive exactly
   * as long as the payload `hydrate.ts` keyed it by. See {@link tetherWrite}.
   */
  tether: LaneTether | undefined;
  /**
   * The reading side's {@link LaneMergePublication}, left here by
   * {@link readOrCreate} because the publication that consults it arrives from
   * the other side of the store. Last read to declare one wins; a read that
   * declares none leaves what is there, since nothing else can answer for it.
   */
  merge: LaneMergePublication | undefined;
};

export const DEFAULT_GC_TIME = 5 * 60_000;

const laneStates = new WeakMap<Lane, LaneState>();

export function createLane(options: LaneOptions = {}): Lane {
  const state: LaneState = {
    entries: new Map(),
    gcTime: options.gcTime ?? DEFAULT_GC_TIME,
    refresh: options.refresh,
    refreshScheduled: false,
    reaskTimer: undefined,
    revisionCounter: 0,
    warmTime: options.warmTime ?? DEFAULT_WARM_TIME,
    sweepAt: undefined,
    sweepTimer: undefined,
  };

  const lane: Lane = {
    prefetch<T, C = T>(read: LaneReadSpec<T, C>, ...args: LaneLoaderMetaArgs) {
      // Warm the cache without subscribing or suspending; a re-fired prefetch
      // dedupes onto the existing cache. `warmTime` / `fallback` describe the
      // load and apply here; `staleTime` / `gcTime` describe a reader.
      if (isExternalLoader(read.loader)) {
        // Also rejected by `LaneReadSpec`'s loader type; catches `any` / cast.
        // Warming an external key would only ever hit the timeout.
        throw new LaneOwnershipError(
          read.key,
          serializeKey(read.key),
          "prefetch",
        );
      }

      return readOrCreate<T, C>(lane, serializeKey(read.key), read.key, read.loader, {
        // Same precedence as a hook read: the read's own override wins.
        loaderMeta: read.loaderMeta ?? args[0]?.loaderMeta,
        warmTime: read.warmTime,
        fallback: read.fallback as LaneReadOptions["fallback"],
      });
    },
    startInvalidationTransition(scope) {
      startScopeInvalidationTransition(state, scope);
    },
    invalidate(key, options = {}) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      invalidateLaneEntry(state, entry, options, invalidationSource(options));
    },
    invalidateAll(scope, options = {}) {
      const source = invalidationSource(options);

      for (const entry of matchingEntries(state.entries, scope)) {
        invalidateLaneEntry(state, entry, options, source);
      }
    },
    set<T>(key: LaneKey, valueOrPromise: LaneValue<T>) {
      return publishEntry<T>(lane, key, valueOrPromise);
    },
    update<T>(key: LaneKey, updater: LaneUpdater<T>) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return undefined;
      }

      return updateLaneEntry(state, entry, updater);
    },
    updateAll<T>(scope: LaneScope, updater: LaneUpdater<T>) {
      return matchingEntries(state.entries, scope).flatMap((entry) => {
        const promise = updateLaneEntry(state, entry, updater);
        return promise ? [promise] : [];
      });
    },
    remove(key) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      removeLaneEntry(state, entry);
    },
    removeAll(scope) {
      for (const entry of matchingEntries(state.entries, scope)) {
        removeLaneEntry(state, entry);
      }
    },
    cancel(key) {
      const entry = state.entries.get(serializeKey(key));

      if (!entry) {
        return;
      }

      cancelLaneEntry(entry);
    },
  };

  laneStates.set(lane, state);

  return lane;
}

/**
 * Install the owner-ask on a lane — what `<LaneProvider refresh>` calls with
 * the lane it holds or created, so a lane built by `createLane()` and one built
 * by the provider end up in the same state. Not exported from the package:
 * `refresh` is a construction option, never a method on the lane.
 */
export function setLaneRefresh(
  lane: Lane,
  refresh: (() => void) | undefined,
): void {
  getLaneState(lane).refresh = refresh;
}

/**
 * `lane.set` addressed by key, as the publication path (`hydrate.ts`) needs.
 * A `publication` bucket marks the key filled from outside and seats the entry
 * in that bucket: retention is that payload's, for the value published now and
 * for whatever the client writes over it (see {@link tetherWrite}). Not
 * exported from the package — `lane.set` is the public way to publish.
 */
export function publishEntry<T>(
  lane: Lane,
  key: LaneKey,
  valueOrPromise: LaneValue<T>,
  publication?: Promise<unknown>[],
): Promise<LaneRead<T>> {
  const state = getLaneState(lane);
  const entry = getOrCreateEntry(state, key, serializeKey(key));

  if (publication) {
    markExternal(entry);
    // Taken before the value is written, so the published value is the first
    // thing to sit in the seat; a new publication moves the entry to its own
    // bucket, and the superseded one dies with the payload it belongs to.
    entry.tether = { at: publication.length, bucket: externalRef(publication) };
  }

  const promise = publishEntryValue(
    state,
    entry,
    // Only what an owner published is merged with what stands there. A
    // `lane.set` is the client stating a whole value it already has — there is
    // nothing of the store's to keep alongside it.
    publication ? mergePublication(entry, valueOrPromise) : valueOrPromise,
  );

  notifyInvalidate(entry, "transition");

  return promise;
}

/**
 * What a publication becomes on an entry whose read declared a
 * {@link LaneMergePublication} — the one place a published value is not stored
 * as it arrived.
 *
 * It runs **here**, in the write path, rather than in a reader, for two
 * reasons. A reader would have to commit the published value on its way to the
 * merged one, so the screen would show the shallow list for a frame. And a
 * hidden `<Activity>` reader gets no notification at all, so a publication
 * landing while it is hidden has to be merged by the time it is revealed.
 *
 * "The entry holds a value" is answered synchronously, from the promise cache
 * protocol's stamps on the promise it holds (`status` / `value`): Lane's own on
 * a value it was handed (`set`, a publication), React's on a chain some reader
 * has `use()`d. A value nobody has rendered carries no stamp and reads as
 * absent — a real limit, documented where the policy is.
 */
function mergePublication<T>(
  entry: LaneEntry,
  published: LaneValue<T>,
): LaneValue<T> {
  const { cache, merge } = entry;

  // A published promise has no value to compare yet, and waiting for one would
  // give up the synchronous landing this whole path exists for.
  if (!merge || !cache || isPromiseLike(published)) {
    return published;
  }

  const stamped = cachedPromise(entry, cache) as
    | LaneThenable<LaneRead<unknown>>
    | undefined;
  const held =
    stamped?.status === "fulfilled" ? stamped.value?.data : undefined;

  return held === undefined
    ? published
    : (merge({ held, key: entry.key, published }) as T);
}

/**
 * Record that this key is filled from outside, once; converts an existing
 * cache slot so `entry.external` stays a sound description of it.
 */
function markExternal(entry: LaneEntry): void {
  if (entry.external) {
    return;
  }

  entry.external = true;

  if (entry.cache) {
    entry.cache.promise = externalRef(entry.cache.promise as Promise<unknown>);
  }
}

/**
 * Addressed by canonical id like every internal entry API; the key rides along
 * as creation material. `keyId` must be `serializeKey(key)`.
 */
export function readOrCreate<T, C = T>(
  lane: Lane,
  keyId: string,
  key: LaneKey,
  loader: LaneLoader<T, C>,
  options?: LaneReadOptions,
): Promise<LaneRead<T>> {
  const state = getLaneState(lane);
  const entry = getOrCreateEntry(state, key, keyId);
  // An `external` read declares the key is filled from outside; retention and
  // the owner-ask hang off this. Nothing downstream re-checks the loader.
  const isExternal = isExternalLoader(loader);

  if (options?.merge) {
    // Left on the entry before anything can be read or published: the write
    // path is where it is consulted, and it must be there by then.
    entry.merge = options.merge;
  }

  if (isExternal) {
    markExternal(entry);
  } else if (
    // A publication marked this key external but this read supplies a client
    // loader — a mistake nothing downstream reports until a write throws.
    // Checked here: only here do both facts exist (a key carries no loader).
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    entry.external
  ) {
    warnDev(
      `${keyId} is filled from outside — a publication seeded it, or another ` +
        "read declares `loader: external` for it — but this read supplies a " +
        "client loader. Two loaders for one key: whichever runs last decides " +
        "what is stored, its value is held weakly rather than for `gcTime`, " +
        "and it is stored with none of a client-owned entry's guarantees — no " +
        "stale-on-error fallback, no `current` for the next load, no structural " +
        "sharing. Read it with `loader: external` and let Lane ask its owner, " +
        "or stop seeding the key and let the client load it.",
    );
  }

  const reusable = reuseCache(entry);

  if (reusable) {
    if (isExternal) {
      askOwner(state, entry);
    }

    return reusable as Promise<LaneRead<T>>;
  }

  const controller = new AbortController();
  // Snapshot: a publication landing before the loader runs must not change this.
  const current = entry.lastFulfilled?.value as C | undefined;
  const promise = runLoader(loader, key, controller.signal, options, current);
  const read = setEntryCache(state, entry, promise, controller, options);

  if (isExternal) {
    // The cache this read just installed *is* the wait — nothing can have
    // replaced it in between, so marking it here rather than threading a flag
    // through `setEntryCache` says the same thing in one place.
    if (entry.cache) {
      entry.cache.waiting = true;
    }

    askOwner(state, entry);
  }

  return read;
}

/**
 * Ask the owner to publish this key again — the whole of what an external read
 * does about a value it does not have.
 *
 * Asked **on the read**, not when the wait is created: Next's router discards a
 * pending `router.refresh()` the moment a navigation starts ("Navigations take
 * priority over any pending actions", `app-router-instance.js`), so a wait made
 * before a navigation would sit unfilled forever. A reveal's re-read finds the
 * same unsettled wait and asks again, which is the self-repair.
 *
 * Only for a shell that has held a value ({@link LaneEntry.published}): before
 * the first publication the payload is already on its way (streaming SSR, a
 * reader outside every boundary) and asking would re-render the route for data
 * that is arriving anyway.
 *
 * Deferred, and one ask per tick per lane. Deferred because reads run during
 * render and `router.refresh()` dispatches a React update; coalesced because N
 * readers of N keys invalidated together are one thing to ask for. Nothing
 * tracks the ask beyond the tick: `refresh` returns `void`, so completion
 * cannot be observed, and inferring it from the next publication is wrong —
 * a navigation's payload need not carry this key at all.
 */
function askOwner(state: LaneState, entry: LaneEntry): void {
  if (!entry.published) {
    return;
  }

  const cache = entry.cache;

  // A settled value, or a write of one in flight, needs no owner.
  if (cache && !(cache.waiting && cache.settlement === undefined)) {
    return;
  }

  if (state.refresh === undefined || state.refreshScheduled) {
    return;
  }

  state.refreshScheduled = true;
  defer(() => {
    // Cleared first: a `refresh` that throws must not wedge the lane, and an
    // ask raised from inside one belongs to the next tick.
    state.refreshScheduled = false;
    scheduleReask(state);
    state.refresh?.();
  });
}

/**
 * How long an ask is given before Lane asks again for a reader still waiting.
 * Shorter than {@link EXTERNAL_TIMEOUT} by enough to ask several times.
 */
export const REASK_INTERVAL = 2_000;

/**
 * An ask can be lost on its way: a `router.refresh()` is aborted by a
 * navigation that starts while it is in flight, which is what a mutation that
 * invalidates and then navigates does in one breath. The wait it was meant to
 * fill has no reader rendering — a suspended reader re-renders only when its
 * promise settles — so nothing reads, and nothing asks. Without this, the
 * reader would sit in the boundary's fallback until the wait's timeout.
 *
 * So while a wait that was asked for is still unsettled **and someone is
 * subscribed to it** — a committed reader, visible or in its fallback — Lane
 * looks again every {@link REASK_INTERVAL} and asks once more. A wait nobody is
 * subscribed to (a hidden tree's, a departed reader's) is not re-asked for: its
 * reveal reads and asks for itself. Bounded by the wait's own timeout: a
 * rejected wait is cleared and no longer waiting, so the looking stops.
 *
 * Nothing here tracks whether an ask *completed* — `refresh` returns `void`
 * and a publication need not carry this key. It only keeps asking while
 * someone is still waiting, which is the same rule as asking on a read.
 */
function scheduleReask(state: LaneState): void {
  if (state.reaskTimer !== undefined) {
    return;
  }

  state.reaskTimer = setTimeout(() => {
    state.reaskTimer = undefined;

    for (const entry of state.entries.values()) {
      const cache = entry.cache;

      if (
        entry.published &&
        entry.subscribers.size > 0 &&
        cache?.waiting &&
        cache.settlement === undefined
      ) {
        // One ask covers every waiting key; `askOwner` schedules the next look.
        askOwner(state, entry);
        return;
      }
    }
  }, REASK_INTERVAL);
}

/** Out of render, as cheaply as the platform allows. */
const defer: (task: () => void) => void =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (task) => {
        setTimeout(task, 0);
      };

/**
 * A read takes whatever promise the entry has — never discarding, retrying, or
 * notifying: React re-renders a suspended reader arbitrarily, and dropping
 * what others hold would notify them mid-render. Values leave only through
 * events (invalidate, remove, publication, eviction); an external entry's
 * collected value reads as absent and re-runs the (waiting) loader.
 */
function reuseCache(entry: LaneEntry): Promise<unknown> | undefined {
  const cache = entry.cache;

  if (!cache) {
    return undefined;
  }

  const promise = cachedPromise(entry, cache);

  if (promise === undefined) {
    // Pruned on read: the first moment the shell's emptiness matters.
    entry.cache = undefined;

    return undefined;
  }

  return promise;
}

export function invalidateEntry(
  lane: Lane,
  keyId: string,
  options: LaneInvalidateOptions = {},
  source: LaneInvalidationSource = "transition",
): void {
  const state = getLaneState(lane);
  const entry = state.entries.get(keyId);

  if (!entry) {
    return;
  }

  invalidateLaneEntry(state, entry, options, source);
}

/**
 * `Lane.update` addressed by canonical id (twin of `invalidateEntry`), so
 * hooks need not keep the key array alive to re-serialize.
 */
export function updateEntry<T>(
  lane: Lane,
  keyId: string,
  updater: LaneUpdater<T>,
): Promise<LaneRead<T>> | undefined {
  const state = getLaneState(lane);
  const entry = state.entries.get(keyId);

  if (!entry) {
    return undefined;
  }

  return updateLaneEntry(state, entry, updater);
}

/** Same id-plus-key contract as {@link readOrCreate}. */
export function subscribeLane(
  lane: Lane,
  keyId: string,
  key: LaneKey,
  subscriber: LaneSubscriber,
): () => void {
  const state = getLaneState(lane);
  const entry = getOrCreateEntry(state, key, keyId);

  entry.subscribers.add(subscriber);
  entry.evictAt = undefined; // held: not a GC candidate

  return () => {
    entry.subscribers.delete(subscriber);

    if (entry.subscribers.size > 0) {
      return;
    }

    if (entry.external) {
      // Never timed out: the shell stays; reachability (checked on read) decides.
      return;
    }

    if (!entry.cache) {
      // No cache and no subscribers: nothing worth keeping, drop now.
      if (state.entries.get(entry.keyId) === entry) {
        state.entries.delete(entry.keyId);
      }

      return;
    }

    // Idle with a cache: retained until the departing reader's `gcTime` is up.
    entry.evictAt = Date.now() + resolveGcTime(state, subscriber.gcTime?.());
    scheduleSweep(state);
  };
}

/**
 * The entry's current promise — read-back behind the bound `invalidate` for an
 * `onlyIf` that declined. Not public: returns only what a read already created.
 */
export function peekEntryPromise(
  lane: Lane,
  keyId: string,
): Promise<unknown> | undefined {
  const entry = getLaneState(lane).entries.get(keyId);
  const cache = entry?.cache;

  return entry && cache ? cachedPromise(entry, cache) : undefined;
}

export function onInvalidate(
  lane: Lane,
  key: LaneKey,
  listener: LaneSubscription,
): () => void {
  return subscribeLane(lane, serializeKey(key), key, { onInvalidate: listener });
}

export function onRemove(
  lane: Lane,
  key: LaneKey,
  listener: LaneRemoveSubscription,
): () => void {
  return subscribeLane(lane, serializeKey(key), key, { onRemove: listener });
}

function invalidateLaneEntry(
  state: LaneState,
  entry: LaneEntry,
  options: LaneInvalidateOptions,
  source: LaneInvalidationSource,
): void {
  if (!shouldInvalidateEntry(entry, options)) {
    return;
  }

  removeEntryCache(entry);
  notifyInvalidate(entry, source);
  cleanupEntry(state, entry);
}

function removeLaneEntry(state: LaneState, entry: LaneEntry): void {
  removeEntryCache(entry);
  // Drop `lastFulfilled` too: it feeds the stale-on-error fallback and the
  // next loader's `current`, either of which would serve removed data back.
  entry.lastFulfilled = undefined;
  notifyRemove(entry);
  cleanupEntry(state, entry);
}

/**
 * Stop an in-flight read without notifying — announcing would turn "stop" into
 * "start again"; readers keep their promise and it settles underneath them.
 * The cache stays: with a previous value the settlement folds the abort into
 * it (original fulfillment time kept); with nothing to revert to it settles
 * rejected — an emptied entry would turn React's retry of the uncommitted
 * render into a fresh load. A settled cache is left alone.
 */
function cancelLaneEntry(entry: LaneEntry): void {
  const cache = entry.cache;

  if (!cache || cache.settlement !== undefined) {
    return;
  }

  cache.cancelled = true;
  cache.controller?.abort();
}

function updateLaneEntry<T>(
  state: LaneState,
  entry: LaneEntry,
  updater: LaneUpdater<T>,
): Promise<LaneRead<T>> | undefined {
  const cache = entry.cache;
  const promise = cache && cachedPromise(entry, cache);

  if (!cache || !promise || cache.settlement?.kind === "rejected") {
    return undefined;
  }

  const info = { key: entry.key, keyId: entry.keyId };
  const valueOrPromise = promise.then((current) =>
    updater((current as LaneRead<T>).data, info),
  );
  // The updater adopts the in-flight result, so the previous controller must
  // stay un-aborted and keeps guarding the chained cache.
  const updated = setEntryCache(state, entry, valueOrPromise, cache.controller, undefined);

  tetherWrite(entry, updated);
  notifyInvalidate(entry, "transition");

  return updated;
}

function publishEntryValue<T>(
  state: LaneState,
  entry: LaneEntry,
  valueOrPromise: LaneValue<T>,
): Promise<LaneRead<T>> {
  // An external entry's abort carries the publication as its reason: a reader
  // suspended on the wait is retried only when its promise settles, so the
  // wait must end fulfilled with the published value.
  entry.cache?.controller?.abort(
    entry.external ? publicationReason(valueOrPromise) : undefined,
  );

  const promise = setEntryCache(state, entry, valueOrPromise, undefined, undefined);

  tetherWrite(entry, promise);

  return promise;
}

/**
 * Drop a shell nothing is holding and nothing is in. An external shell is never
 * dropped: it carries {@link LaneEntry.published}, and losing that would make
 * the next read look like a first mount — waiting in silence for a publication
 * nobody is going to send, instead of asking the owner for one.
 */
function cleanupEntry(state: LaneState, entry: LaneEntry): void {
  if (entry.external || entry.cache || entry.subscribers.size > 0) {
    return;
  }

  state.entries.delete(entry.keyId);
}

function notifyInvalidate(
  entry: LaneEntry,
  source: LaneInvalidationSource,
): void {
  const info = entryInfo(entry);

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onInvalidate?.(info, source);
  }
}

/**
 * Open the invalidation transition of every reader in a scope without touching
 * a cache: replacing the cache would make readers re-read pre-mutation data.
 */
function startScopeInvalidationTransition(
  state: LaneState,
  scope: LaneScope,
): void {
  for (const entry of matchingEntries(state.entries, scope)) {
    notifyInvalidationPending(entry);
  }
}

function notifyInvalidationPending(entry: LaneEntry): void {
  const info = entryInfo(entry);

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onInvalidationPending?.(info);
  }
}

function notifyRemove(entry: LaneEntry): void {
  const info = entryInfo(entry);

  for (const subscriber of [...entry.subscribers]) {
    subscriber.onRemove?.(info);
  }
}

function getOrCreateEntry(
  state: LaneState,
  key: LaneKey,
  keyId: string,
): LaneEntry {
  const existing = state.entries.get(keyId);

  if (existing) {
    return existing;
  }

  const entry = createEntry(state, key, keyId);
  state.entries.set(keyId, entry);

  return entry;
}

function getLaneState(lane: Lane): LaneState {
  const state = laneStates.get(lane);

  if (!state) {
    throw new TypeError("Unknown Lane instance");
  }

  return state;
}

function entryInfo(entry: LaneEntry): LaneEntryInfo {
  return {
    key: entry.key,
    keyId: entry.keyId,
  };
}

function noop(): void {}

/**
 * Rejection for a cancelled read whose loader ignored the signal and resolved.
 * Shared instance; a plain `Error`, not `DOMException` (Hermes lacks it).
 */
const CANCELLED = new Error("Lane read cancelled");

function matchingEntries(
  entries: Map<string, LaneEntry>,
  scope: LaneScope,
): LaneEntry[] {
  const matches =
    typeof scope === "function"
      ? scope
      : (entry: { key: LaneKey }) => isPrefixKey(scope, entry.key);

  return [...entries.values()].filter((entry) =>
    matches({ key: entry.key, keyId: entry.keyId }),
  );
}

function runLoader<T, C>(
  loader: LaneLoader<T, C>,
  key: LaneKey,
  signal: AbortSignal,
  options: LaneReadOptions | undefined,
  current: C | undefined,
): Promise<T> {
  // Deferred so a synchronously-throwing loader rejects the read instead of
  // throwing out of the render. `options` is built fresh per read, so reading
  // it inside the callback is safe where `current` had to be snapshotted.
  return Promise.resolve().then(() =>
    loader({
      current,
      key,
      meta: options?.loaderMeta as LaneLoaderMeta,
      signal,
    }),
  );
}

function createEntry(state: LaneState, key: LaneKey, keyId: string): LaneEntry {
  return {
    cache: undefined,
    external: false,
    // No deadline while a load is in flight — a suspended render may be
    // waiting on it. The clock starts at settlement (see `startWarmClock`).
    evictAt: undefined,
    key,
    keyId,
    lastFulfilled: undefined,
    merge: undefined,
    published: false,
    revision: 0,
    subscribers: new Set(),
    tether: undefined,
  };
}

/**
 * Start the pre-arrival clock on an entry that settled unheld (unread
 * prefetch, or a suspend that went away). `warmTime`, not `gcTime` — that
 * answers the different question "somebody had this and left".
 */
function startWarmClock(
  state: LaneState,
  entry: LaneEntry,
  options: LaneReadOptions | undefined,
): void {
  if (entry.subscribers.size > 0) {
    return;
  }

  entry.evictAt = Date.now() + (options?.warmTime ?? state.warmTime);
  scheduleSweep(state);
}

/**
 * A promise for a value already in hand, fulfilled before it is returned:
 * `status` and `value` written at creation with no microtask in between, so
 * `use()` reads it in the very render that receives it.
 *
 * That is what the one path that cannot wait needs. A reveal adopts the store's
 * promise from a layout effect — a synchronous update with no microtask to wait
 * in — so an unstamped promise commits the boundary's fallback and comes back
 * on a retry React throttles fallbacks on for 300ms.
 *
 * Only for a value the store received synchronously (`set(key, value)`, a
 * publication seed). A promise is left exactly as it arrived: it is the
 * caller's or the loader's result passed through, and there is nothing the
 * store can say about it synchronously. React writes the same fields itself on
 * the first `use()` of one.
 */
function instrumentedValue<T>(value: T): Promise<T> {
  const thenable = Promise.resolve(value) as LaneThenable<T>;

  thenable.status = "fulfilled";
  thenable.value = value;

  return thenable;
}

function setEntryCache<T>(
  state: LaneState,
  entry: LaneEntry,
  valueOrPromise: LaneValue<T>,
  controller: AbortController | undefined,
  options: LaneReadOptions | undefined,
): Promise<LaneRead<T>> {
  const startedAt = Date.now();

  // A value, not a promise: the settlement bookkeeping and the read itself
  // happen in this same synchronous run, so the promise handed back is already
  // fulfilled — the case a reveal cannot wait a microtask for. The async path's
  // displacement checks have no window to guard here: nothing can replace
  // `entry.cache` between building this read and installing it.
  if (!isPromiseLike(valueOrPromise)) {
    const value = shareWithLastFulfilled(entry, valueOrPromise);
    rememberFulfilled(state, entry, startedAt, value);
    const settled = instrumentedValue<LaneRead<T>>(settledRead(entry, value));

    entry.cache = {
      cancelled: false,
      controller,
      promise: cacheSlot(entry, settled),
      settlement: { at: startedAt, kind: "fulfilled" },
      startedAt,
      waiting: false,
    };
    startWarmClock(state, entry, options);

    return settled;
  }

  const cache: LanePromiseCache = {
    cancelled: false,
    controller,
    promise: undefined as unknown as Promise<unknown>,
    settlement: undefined,
    startedAt,
    waiting: false,
  };

  // Every way this read can end goes through here; settling is when the
  // pre-arrival clock can start.
  const settle = (settlement: LanePromiseSettlement) => {
    cache.settlement = settlement;
    startWarmClock(state, entry, options);
  };

  /**
   * Lands a read with no usable value (rejection, or cancelled read whose
   * loader resolved anyway): serves the read's `fallback` policy, else the
   * default (last fulfilled value, else reject); a policy that throws lands in
   * the empty case. What is served is not stored — `lastFulfilled` moves only
   * on genuine success and freshness keeps the original time, which is why the
   * policy lives here, not in a loader try/catch (a substitute would look like
   * success and restamp both). A cancel skips the policy and reverts silently.
   */
  const settleWithoutValue = (error: unknown): LaneRead<T> => {
    const previous = entry.lastFulfilled;

    // No policy runs for an external key (nothing to fall back to) or a cancel.
    const policy =
      entry.external || cache.cancelled ? undefined : options?.fallback;
    let served: { value: unknown } | undefined = previous
      ? { value: previous.value }
      : undefined;

    // A policy that throws replaces the failure with its own account of it.
    let unanswered = error;

    if (policy) {
      try {
        served = {
          value: policy({
            error,
            key: entry.key,
            lastFulfilled: previous?.value,
          }),
        };
      } catch (declined: unknown) {
        // Declining lands in the default's empty case; the throw must not
        // escape past the `settle` below or the cache is left unsettled.
        served = undefined;
        unanswered = declined;
      }
    }

    if (!served) {
      settle({ at: Date.now(), kind: "rejected" });

      // An external key's failure is "nobody answered", never an answer, so it
      // is not kept: the readers holding this promise are rejected, and the
      // entry is left with no cache so the next read — a retry from an error
      // boundary, a reveal — makes a fresh wait and asks again instead of
      // being handed back a rejection that has already been reported.
      if (entry.external && entry.cache === cache) {
        entry.cache = undefined;
      }

      // This throw unmounts the reader, so wrap the error to carry the key to
      // the boundary (see `LaneReadError`). An external key's error passes
      // through unwrapped: the client did not start this load.
      throw entry.external
        ? unanswered
        : new LaneReadError(entry.key, entry.keyId, unanswered);
    }

    // Freshness is the entry's, not this settlement's: previous fulfillment
    // time, or the epoch — so triggers keep firing on a failing key. The
    // epoch, not `-Infinity`: `staleTime: Infinity` must still mean never stale.
    settle({ at: previous?.at ?? 0, kind: "fulfilled" });

    // `entry.revision` names what `lastFulfilled` holds; a policy serving
    // anything else gets a fresh revision — one number must never name two
    // different values.
    const servedEntryValue =
      previous !== undefined && Object.is(served.value, previous.value);
    const read = settledRead(
      entry,
      served.value as T,
      servedEntryValue ? entry.revision : ++state.revisionCounter,
    );

    // Not on a cancel: the caller asked for the stop, so every consumer that
    // renders `error` would otherwise have to filter out an abort it requested
    // itself.
    if (!cache.cancelled) {
      read.error = error;
    }

    return read;
  };

  const guarded: Promise<LaneRead<T>> = valueOrPromise.then(
    (value) => {
      if (entry.cache !== cache) {
        // Displaced before settling: this value never became the entry's
        // content, so it gets its own revision — `entry.revision` would pair
        // it with whatever settled *after* it. An external wait resolved by
        // its own publication lands here too.
        return settledRead(entry, value, ++state.revisionCounter);
      }

      // Cancelled mid-flight: a loader that ignored its `signal` still
      // resolves, and adopting the value would silently undo the cancel.
      if (cache.cancelled) {
        return settleWithoutValue(CANCELLED);
      }

      const at = Date.now();
      const shared = shareWithLastFulfilled(entry, value);

      settle({ at, kind: "fulfilled" });
      rememberFulfilled(state, entry, at, shared);

      return settledRead(entry, shared);
    },
    (error: unknown) => {
      if (entry.cache !== cache) {
        throw error;
      }

      return settleWithoutValue(error);
    },
  );

  // A rejected cache no reader consumes must not be an unhandled rejection.
  guarded.catch(noop);
  cache.promise = cacheSlot(entry, guarded);
  entry.cache = cache;

  return guarded;
}

/**
 * Strong slot for a client-owned entry; weak for an external one — publisher
 * and committed readers keep it reachable, which also distinguishes a hidden
 * subtree (still holds its promise) from an unmounted one.
 *
 * A client write onto an external entry lives as long as the publication it
 * overwrote: {@link tetherWrite} seats it in that payload's bucket, so the
 * client's version of the value is reachable for exactly as long as the version
 * it replaced would have been. Nothing is pinned, and `gcTime` still says
 * nothing about an external key.
 *
 * The edge: a write landing when the payload is already gone has no bucket to
 * sit in and is held by its readers alone, so it can go with them. The read
 * that finds it gone asks the owner — the same recovery as for a collected
 * publication, and the same state the owner is in.
 */
function cacheSlot(
  entry: LaneEntry,
  promise: Promise<unknown>,
): LanePromiseCache["promise"] {
  return entry.external ? externalRef(promise) : promise;
}

/**
 * Put what an external entry now holds in its seat in the publication's bucket.
 * One seat per entry per publication: a write replaces the value it overwrote
 * rather than piling up behind it, so a key written a thousand times retains
 * one promise, not a thousand. Nothing to do for a client-owned entry (`gcTime`
 * holds that one) or once the payload — and with it the bucket — is gone.
 */
function tetherWrite(entry: LaneEntry, promise: Promise<unknown>): void {
  const tether = entry.tether;
  const bucket = tether?.bucket.deref();

  if (!tether || !bucket) {
    return;
  }

  bucket[tether.at] = promise;
}

/** A weakly held object: alive, or collected and so indistinguishable from absent. */
type LaneWeakSlot<T extends object> = { deref(): T | undefined };

/** An external entry's seat in the bucket of the publication that last filled it. */
type LaneTether = {
  bucket: LaneWeakSlot<Promise<unknown>[]>;
  /** The index of the seat — the same one every write to this entry takes. */
  at: number;
};

type LaneWeakSlotFactory = <T extends object>(value: T) => LaneWeakSlot<T>;

const weakSlot: LaneWeakSlotFactory = (value) => new WeakRef(value);

let externalRef: LaneWeakSlotFactory = weakSlot;

/**
 * Test seam (not exported from the package): collection is not schedulable, so
 * tests install a killable reference — for the value slots and for the
 * publication buckets they are tethered to, which go together when a payload
 * is dropped. `undefined` restores the `WeakRef` default.
 */
export function setExternalRefFactory(
  factory: LaneWeakSlotFactory | undefined,
): void {
  externalRef = factory ?? weakSlot;
}

/** The cached read; only an external entry's slot has to be deref'd. */
function cachedPromise(
  entry: LaneEntry,
  cache: LanePromiseCache,
): Promise<unknown> | undefined {
  return entry.external
    ? (cache.promise as LaneWeakSlot<Promise<unknown>>).deref()
    : (cache.promise as Promise<unknown>);
}

/**
 * Record a fulfilled value as the entry's last and advance the revision, in
 * the same synchronous run so number and data never pair up wrong. A new
 * reference means new content (structural sharing already collapsed deep-equal
 * refetches; `Object.is`, so `NaN` is not forever-changing). An external entry
 * keeps no `lastFulfilled` (a strong ref the weak retention forbids), so every
 * publication mints: "same revision ⇒ same content" holds, but a republish of
 * identical content reads as new.
 *
 * This is also where an external shell learns it has been filled — by its owner
 * or by a client `set`, which are the same event to a reader — and the mark
 * outlives every value the entry goes on to hold.
 */
function rememberFulfilled(
  state: LaneState,
  entry: LaneEntry,
  at: number,
  value: unknown,
): void {
  if (entry.external) {
    entry.published = true;
    entry.revision = ++state.revisionCounter;
    return;
  }

  if (
    entry.lastFulfilled === undefined ||
    !Object.is(entry.lastFulfilled.value, value)
  ) {
    entry.revision = ++state.revisionCounter;
  }

  entry.lastFulfilled = { at, value };
}

/** Data under the revision that names it — the entry's, unless the caller mints one. */
function settledRead<T>(
  entry: LaneEntry,
  data: T,
  revision = entry.revision,
): LaneRead<T> {
  return { data, revision };
}

function shareWithLastFulfilled<T>(entry: LaneEntry, value: T): T {
  const previous = entry.lastFulfilled;

  return previous ? replaceEqualDeep(previous.value, value) : value;
}

function removeEntryCache(entry: LaneEntry): void {
  entry.cache?.controller?.abort();
  entry.cache = undefined;
}

/** A read's `gcTime`, defaulting to the lane's (a default, not a floor or ceiling). */
function resolveGcTime(state: LaneState, gcTime: number | undefined): number {
  return gcTime ?? state.gcTime;
}

/**
 * One coalesced GC timer per lane, armed for the nearest deadline (`gcTime` is
 * per-read). Eviction is never synchronous, even at `gcTime: 0`: StrictMode
 * runs subscribe → cleanup → subscribe in one commit, and a re-suspension
 * re-creates layout effects — either would collect an entry whose reader never
 * left; a resubscribe clears `evictAt` before the timer fires.
 */
function scheduleSweep(state: LaneState): void {
  let nearest: number | undefined;

  for (const entry of state.entries.values()) {
    // External entries are not the lane's to collect: reachability decides.
    if (entry.external || entry.evictAt === undefined) {
      continue;
    }

    if (Number.isFinite(entry.evictAt) && (nearest === undefined || entry.evictAt < nearest)) {
      nearest = entry.evictAt;
    }
  }

  if (nearest === undefined) {
    if (state.sweepTimer !== undefined) {
      clearTimeout(state.sweepTimer);
      state.sweepTimer = undefined;
      state.sweepAt = undefined;
    }

    return;
  }

  // Armed timer already fires at or before this deadline; it re-arms for the rest.
  if (state.sweepTimer !== undefined && state.sweepAt !== undefined && state.sweepAt <= nearest) {
    return;
  }

  if (state.sweepTimer !== undefined) {
    clearTimeout(state.sweepTimer);
  }

  const timer = setTimeout(() => sweep(state), Math.max(0, nearest - Date.now()));
  state.sweepTimer = timer;
  state.sweepAt = nearest;
  unrefTimer(timer);
}

function sweep(state: LaneState): void {
  const now = Date.now();

  state.sweepTimer = undefined;
  state.sweepAt = undefined;

  for (const entry of [...state.entries.values()]) {
    if (entry.external || entry.evictAt === undefined) {
      continue;
    }

    if (now >= entry.evictAt) {
      evictEntry(state, entry);
    }
  }

  scheduleSweep(state);
}

function evictEntry(state: LaneState, entry: LaneEntry): void {
  removeEntryCache(entry);
  state.entries.delete(entry.keyId);
}

/**
 * Public invalidations converge through a transition by default; `background:
 * true` keeps automatic refreshes (e.g. polls) out of `isInvalidationPending`.
 */
export function invalidationSource(
  options?: LaneInvalidateOptions,
): LaneInvalidationSource {
  return options?.background ? "background" : "transition";
}

function unrefTimer(timer: unknown): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof (timer as { unref: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}

function shouldInvalidateEntry(
  entry: LaneEntry,
  options: LaneInvalidateOptions,
): boolean {
  if (!options.onlyIf) {
    return true;
  }

  const cache = entry.cache;

  if (!cache?.settlement) {
    return false;
  }

  if (options.onlyIf === "settled") {
    return true;
  }

  // Exactly the entries whose readers are in an error boundary (a read that
  // fell back records `fulfilled`) — "retry what is broken" cannot reach
  // anything a reader is showing.
  if (options.onlyIf === "rejected") {
    return cache.settlement.kind === "rejected";
  }

  if (cache.settlement.kind === "rejected") {
    return false;
  }

  return isStale(cache, options.staleTime);
}

/**
 * `staleTime` default: nothing is stale until the app says what stale means.
 * A `0` default would remove the rate limit on the triggers `staleTime` gates,
 * and make a mount refetch what it just loaded (reads run during render,
 * triggers fire from effects).
 */
const DEFAULT_STALE_TIME = Number.POSITIVE_INFINITY;

/**
 * How long a settled entry nobody holds waits for its first reader; the
 * covered cases (hover prefetch → click, a suspend that went away) are short.
 */
const DEFAULT_WARM_TIME = 60_000;

const warned = new Set<string>();

/**
 * Warns once per message. Every call site guards with the literal
 * `typeof process !== "undefined" && process.env.NODE_ENV !== "production"`,
 * written out verbatim — the exact expression bundlers substitute, so the
 * branch and these strings tree-shake out of production builds. A `?.` on
 * `process.env` or an imported boolean defeats the substitution.
 */
export function warnDev(message: string): void {
  if (warned.has(message)) {
    return;
  }

  warned.add(message);
  console.warn(`[lane] ${message}`);
}

function isStale(
  cache: LanePromiseCache,
  staleTime: number | undefined,
): boolean {
  if (cache.settlement?.kind !== "fulfilled") {
    return false;
  }

  // `now - at >= 0`: any staleTime <= 0 is stale; the Infinity default never is.
  return Date.now() - cache.settlement.at >= (staleTime ?? DEFAULT_STALE_TIME);
}

function isPromiseLike<T>(value: LaneValue<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}
