"use client";

import { startTransition, use, useEffect, useState } from "react";
import { useInfiniteLane, useLaneInstance } from "use-lane";
import type {
  InfiniteLaneResult,
  InfiniteLaneValue,
  LaneKeyOf,
  LaneLoaderMeta,
  LaneRead,
  LaneUseOptions,
} from "use-lane";

/**
 * **A list whose first page belongs to somebody else, on public API only.**
 *
 * One screen, two owners. A route owns page 1 — it is what the URL is about, it
 * belongs in the first paint, it changes when the route republishes. The depth
 * below it belongs to the browser. Lane refuses the obvious spelling of that
 * (seed the infinite key, then `loadMore`) because `loadMore` appends through
 * `update` and `update` on a published key throws — so the value has to reach
 * the list some other way, and this hook is that way.
 *
 * It is deliberately **not** in the library. An earlier revision of this spike
 * put it there and paid for it with a version field on every lane entry and a
 * second promise store beside the entry map. Everything below is `useState`,
 * `useEffect`, `useInfiniteLane` and `lane.set`.
 *
 * ## The three states
 *
 * 1. **Steady.** The version the list was built from is the version being handed
 *    down. The hook returns `useInfiniteLane`'s own promise and is inert — which
 *    is what keeps the user's depth through a republication that changed
 *    nothing, an `<Activity>` reveal, or a refresh over a warm cache.
 * 2. **Adopting.** A new *content* version arrived for this list. The render
 *    adjusts its own state and starts returning an **interim promise** built
 *    from the incoming first page — depth 1, no request, and no write to the
 *    store. The old list has no path to the screen from this point on.
 * 3. **Settled.** An effect resets the entry with `lane.set` and flips back to
 *    steady in the same transition, so the two land in one commit. Interim and
 *    entry hold the same content at that moment, so the swap is invisible.
 *
 * ## Why each piece is the way it is
 *
 * **The version must be content identity.** A value delivered as an RSC prop is
 * deserialized afresh on every delivery, so reference identity reports
 * "different" on every refresh and the list would reset constantly. The owner
 * computes a hash; `version` reads it off the page.
 *
 * **The render-phase write is a state adjustment and nothing else.** React's
 * adjust-on-prop-change: same component, idempotent, and safe when the render is
 * discarded, retried, or double-invoked by StrictMode. Writing to the *store*
 * during render would be none of those things — it would replace a list other
 * readers are mid-render on, from a render that may never commit.
 *
 * **`lane.set` is in an effect, not in render.** It is a real, authoritative
 * write, so it belongs in the event phase. It aborts an in-flight `loadMore`,
 * which is correct: that append was deepening the *previous* first page.
 *
 * **The interim promise's identity comes from the prop.** The hook has to return
 * a `Promise<LaneRead<InfiniteLaneValue<P, C>>>` and the prop is a `Promise<P>`,
 * so a wrapper is unavoidable — but building it in render would mint a new one
 * on every attempt, and the render that returns it *suspends* on it (it is a
 * `.then` over an already-resolved promise, so one microtask), which means there
 * is always a retry. A new instance per attempt would suspend again, forever.
 * {@link interim} keys the wrapper on the prop promise in a module-level
 * `WeakMap`: create-if-absent, so every attempt at one render gets the same
 * object, and the row dies with the prop it was derived from.
 *
 * ## The one thing userland cannot do
 *
 * "Which first page is this list standing on" is a fact about the **entry**, and
 * the store does not expose it — so the hook keeps its own answer, per key, in
 * component state. That answer is lost when the component unmounts while the
 * entry survives (`gcTime`), and the hook then treats the list as new and resets
 * it to depth 1. Correct data, lost depth. An entry-level version would close
 * that gap; a previous revision of this spike put one in `packages/lane` and it
 * was rejected as too much weight on every key in the store for what it buys.
 * This is the residue of that decision, and it is a narrow one: it needs a
 * remount over a surviving entry, which for a route-owned list means leaving the
 * route and coming back after React has dropped the tree.
 */

export type HybridInfiniteRead<P, C> = LaneUseOptions & {
  /** Stable. The version is deliberately **not** in it — see the module note. */
  key: LaneKeyOf<InfiniteLaneValue<P, C>>;
  /** The cursor page 1 was loaded at, by its owner, on this client's behalf. */
  initialCursor: C;
  /** Page 1, unawaited, so the route can stream it. */
  firstPagePromise: Promise<P>;
  /** Content identity — equal when the page is the same, different when it is not. */
  version: (page: P) => string;
  /** Pages 2..N. Never called for page 1. */
  fetchPage: (
    cursor: C,
    context: { signal?: AbortSignal; meta: LaneLoaderMeta },
  ) => Promise<P>;
  nextCursor: (page: P, cursor: C) => C | null;
  /** Lab instrumentation. Fires when the loader produces page 1 from the prop. */
  onAdoptFirstPage?: (page: P) => void;
  /** Lab instrumentation. Fires with the interim promise each render that returns one. */
  onInterim?: (promise: Promise<LaneRead<InfiniteLaneValue<P, C>>>) => void;
  /**
   * Lab instrumentation: hold the entry reset open for this long.
   *
   * The adopting window is normally one or two frames, which is too short to
   * click into or to land a second republication in. Stretching it does not
   * change what the effect does — only when — and it is what makes the two
   * hardest cases observable: a `loadMore` fired mid-window (it must be aborted
   * by the reset) and a second content change arriving mid-window (the effect
   * must re-fire for it). Zero, and absent, mean the same thing.
   */
  adoptDelayMs?: number;
};

export type HybridInfiniteResult<P, C> = InfiniteLaneResult<P, C> & {
  /** The resolved first page this render was handed. */
  firstPage: P;
  /** True between "a new first page arrived" and "the entry holds it". */
  isAdopting: boolean;
};

export function useHybridInfiniteLane<P, C>(
  read: HybridInfiniteRead<P, C>,
): HybridInfiniteResult<P, C> {
  const lane = useLaneInstance();
  const firstPage = use(read.firstPagePromise);
  const version = read.version(firstPage);
  const keyId = JSON.stringify(read.key);

  /**
   * What this hook believes each list it has touched is standing on — keyed by
   * list, not one slot.
   *
   * A single "previous version" is the obvious spelling and it is wrong, because
   * a filter change moves *both* the key and the version at once. With one slot,
   * navigating `All → Unassigned → All` reads as two version changes and the
   * second one resets `All` — silently throwing away the depth the user had
   * built there. Measured: depth 3 → 1 on the way back, with the correct page 1,
   * which is the worst kind of bug because the data is right.
   *
   * Per-key, the same trip is: `Unassigned` is new, so adopt it; `All` is known
   * at the version being handed down, so leave it entirely alone. And if
   * something *did* change `All` while the user was away, its version no longer
   * matches and it resets — which is also right.
   *
   * A key this hook has never touched is treated as new. Its entry is either
   * about to be created (the loader adopts the page, and the `set` below is a
   * no-op in content) or it outlived a previous mount, in which case this hook
   * cannot know what it was built from and adopting is the conservative answer:
   * correct data, at the cost of the depth. See the module note on what the
   * store would have to expose to do better.
   */
  const [settled, setSettled] = useState<ReadonlyMap<string, string>>(
    () => new Map([[keyId, version]]),
  );
  const isReady = settled.get(keyId) === version;

  const infinite = useInfiniteLane<P, C>({
    ...read,
    fetchPage: (cursor, context) => {
      // Creation-time adoption, and nothing more: when the walk asks for the
      // page the owner already has, hand it over instead of fetching it. This
      // covers the first mount and every later re-walk (`invalidate`), which is
      // why a deep refresh costs N−1 requests rather than N.
      if (cursor === read.initialCursor) {
        read.onAdoptFirstPage?.(firstPage);
        return Promise.resolve(firstPage);
      }

      return read.fetchPage(cursor, context);
    },
  });

  const adoptDelayMs = read.adoptDelayMs ?? 0;

  useEffect(() => {
    if (isReady) {
      return;
    }

    const adopt = () => {
      startTransition(() => {
        // The entry reset. Authoritative, zero requests, and it aborts whatever
        // the entry had in flight — an append that was deepening the list the
        // previous first page anchored.
        lane.set(
          read.key,
          depthOne(firstPage, read.initialCursor, read.nextCursor),
        );
        // In the same transition, so the reset and the swap back to the entry's
        // promise commit together. Both hold the same content at that instant,
        // so there is nothing to see.
        setSettled((current) => new Map(current).set(keyId, version));
      });
    };

    if (adoptDelayMs <= 0) {
      adopt();
      return;
    }

    // Only the lab path needs a cleanup, and it needs one for a real reason: a
    // second version arriving inside the window re-runs this effect, and the
    // first run's pending reset would otherwise land afterwards and install the
    // page it was built from — the superseded one.
    const timer = setTimeout(adopt, adoptDelayMs);
    return () => clearTimeout(timer);
    // `version` rather than the page object: a republication that changed
    // nothing must not re-fire this, and a *second* content change arriving
    // while this window is still open must. Dropping `version` from the deps
    // strands the list on the first of two rapid republications. `keyId` is
    // there for the same reason one step out — a filter change during the
    // window is a different list to reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, keyId, version, adoptDelayMs]);

  return {
    ...infinite,
    firstPage,
    isAdopting: !isReady,
    // While adopting, the entry still holds the list the previous first page
    // anchored — so it never reaches the screen. The interim is what the reader
    // sees instead, and it is the same content the effect above is about to
    // install.
    promise: isReady
      ? infinite.promise
      : interim(read, firstPage, read.onInterim),
  };
}

function depthOne<P, C>(
  page: P,
  cursor: C,
  nextCursor: (page: P, cursor: C) => C | null,
): InfiniteLaneValue<P, C> {
  return {
    hasNext: nextCursor(page, cursor) !== null,
    pages: [page],
    params: [cursor],
  };
}

/**
 * The interim promise, keyed on the prop it is derived from.
 *
 * A `WeakMap` rather than a hook: `useMemo` and `useState` are both thrown away
 * when a render suspends, and this render always suspends (one microtask, on
 * the `.then` below). The prop promise is the one thing in scope whose identity
 * survives a discarded render — the route owns it — so it is the key.
 *
 * Observationally pure and self-cleaning: create-if-absent means every attempt
 * at one render gets the same object, and the row dies with the prop.
 */
const interimReads = new WeakMap<
  Promise<unknown>,
  Promise<LaneRead<unknown>>
>();

/**
 * Revisions are the lane's to mint, and it will never mint a negative one
 * (`++counter` from zero). Interim values take the other half of the number
 * line, so nothing downstream can mistake one for a lane revision — equality is
 * the whole contract, and these are only ever equal to themselves.
 */
let interimRevision = 0;

function interim<P, C>(
  read: HybridInfiniteRead<P, C>,
  firstPage: P,
  onInterim: HybridInfiniteRead<P, C>["onInterim"],
): Promise<LaneRead<InfiniteLaneValue<P, C>>> {
  const source = read.firstPagePromise;
  const existing = interimReads.get(source);

  if (existing) {
    const cached = existing as Promise<LaneRead<InfiniteLaneValue<P, C>>>;
    onInterim?.(cached);
    return cached;
  }

  const value = depthOne(firstPage, read.initialCursor, read.nextCursor);
  const derived = Promise.resolve<LaneRead<InfiniteLaneValue<P, C>>>({
    data: value,
    revision: -(interimRevision += 1),
  });

  interimReads.set(source, derived as Promise<LaneRead<unknown>>);
  onInterim?.(derived);

  return derived;
}

/**
 * The same create-if-absent trick for a first page that arrives as something
 * other than a plain promise — the published variant maps a
 * `Promise<LaneRead<P>>` down to the `Promise<P>` this hook takes, and doing it
 * inline in render would hand the hook a new prop identity every time.
 */
const mappedSources = new WeakMap<Promise<unknown>, Promise<unknown>>();

export function derivePromise<A, B>(
  source: Promise<A>,
  map: (value: A) => B,
): Promise<B> {
  const existing = mappedSources.get(source);

  if (existing) {
    return existing as Promise<B>;
  }

  const derived = source.then(map);
  mappedSources.set(source, derived);

  return derived;
}
