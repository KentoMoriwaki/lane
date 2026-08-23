"use client";

import { useCallback } from "react";
import { updateEntry } from "./core";
import type { LaneMergePublication } from "./core";
import { serializeKey } from "./keys";
import { useLaneContext } from "./provider";
import { replaceEqualDeep } from "./structural";
import type {
  LaneExternalLoader,
  LaneInvalidate,
  LaneKey,
  LaneKeyOf,
  LaneLoader,
  LaneLoaderMeta,
  LaneRead,
  LaneStartInvalidationTransition,
  LaneUseOptions,
} from "./types";
import { useLane } from "./use-lane";

/**
 * One key's accumulated infinite list. `hasNext` lives in the value so it can
 * never disagree with `pages` mid-render — they arrive together. `params`
 * records each page's cursor so a re-read is reproducible.
 */
export type InfiniteLaneValue<P, C> = {
  pages: P[];
  params: C[];
  hasNext: boolean;
};

export type InfiniteLaneOptions<P, C> = {
  /** The cursor the first page is fetched with. */
  initialCursor: C;
  /**
   * Fetch one page. `signal` is present on the refresh path (the read's abort
   * signal) and absent on the `loadMore` path — `lane.update` hands an updater
   * the current value, not a signal, so an appended page cannot be aborted.
   */
  fetchPage: (
    cursor: C,
    context: { signal?: AbortSignal; meta: LaneLoaderMeta },
  ) => Promise<P>;
  /** The cursor for the page after this one, or `null` at the end of the list. */
  nextCursor: (page: P, cursor: C) => C | null;
};

/**
 * `useInfiniteLane`'s colocated read — key, pagination, and read options
 * together; build one with {@link infiniteLaneRead}.
 */
export type InfiniteLaneReadSpec<P, C> = LaneUseOptions &
  InfiniteLaneOptions<P, C> & {
    key: LaneKey;
  };

/**
 * The list whose **first page belongs to the route**: `loader: external` means
 * no first-page loader is built at all — page 1 arrives by publication, in the
 * accumulated shape (see `infiniteLaneSnapshot`), and `loadMore` fetches pages
 * 2..n from the browser.
 *
 * No `initialCursor`: the published value carries it in `params[0]`, so the
 * cursor page 1 was fetched with is the owner's to state, like the page. And no
 * freshness options, exactly as on {@link LaneExternalReadSpec} — freshness is
 * the owner's. `fetchPage` / `nextCursor` stay required: `loadMore` is the
 * client's half of this list.
 */
export type InfiniteLaneExternalReadSpec<P, C> = Omit<
  InfiniteLaneOptions<P, C>,
  "initialCursor"
> & {
  key: LaneKey;
  loader: LaneExternalLoader;
};

/** Every shape the hook accepts; the body branches on the loader, once. */
type InfiniteLaneAnyReadSpec<P, C> = LaneUseOptions &
  Omit<InfiniteLaneOptions<P, C>, "initialCursor"> & {
    key: LaneKey;
    initialCursor?: C;
    loader?: LaneExternalLoader;
  };

export type InfiniteLaneResult<P, C> = {
  promise: Promise<LaneRead<InfiniteLaneValue<P, C>>>;
  /**
   * Fetch the page after the last one and append it. No-op at the end of the
   * list. Returns the entry's next promise; like any read it resolves (never
   * rejects) on failure — check `error`. `undefined` means nothing to append
   * to (no entry, or the last read rejected).
   */
  loadMore: () => Promise<LaneRead<InfiniteLaneValue<P, C>>> | undefined;
  isInvalidationPending: boolean;
  isBackgroundPending: boolean;
  /** The bound, awaitable `invalidate` — see {@link LaneInvalidate}. */
  invalidate: LaneInvalidate<InfiniteLaneValue<P, C>>;
  startInvalidationTransition: LaneStartInvalidationTransition;
};

/**
 * Read a cursor-paginated list as one key holding the whole accumulated list.
 *
 * Depth is read from `current` (the entry's last fulfilled value) at load time
 * — not from the key (every depth would be a separate cached list) and not
 * from a ref (a remount over a surviving cache would desync and silently
 * truncate).
 *
 * `loadMore` appends one page via `lane.update`; the key never changes, so the
 * list stays on screen through a transition. A re-read (invalidate / focus /
 * mount / poll) re-walks the cursor chain sequentially to the current depth —
 * page N+1's cursor only exists once page N is back, so refreshing five pages
 * is five round trips. A re-derived cursor that comes back `null` early ends
 * the walk: the list genuinely shrank, deliberately not papered over.
 *
 * Actions come from the hook; data from `use(promise)` — never a status object.
 *
 * ```tsx
 * const { promise, loadMore } = useInfiniteLane({
 *   key: ["feed", filters],
 *   initialCursor: null as string | null,
 *   fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
 *   nextCursor: (page) => page.nextCursor,
 * });
 * const { data, error } = use(promise); // data.pages / data.hasNext
 * ```
 *
 * With `loader: external` the first page belongs to the route instead — see
 * {@link InfiniteLaneExternalReadSpec}.
 */
export function useInfiniteLane<P, C>(
  read: InfiniteLaneExternalReadSpec<P, C>,
): InfiniteLaneResult<P, C>;
export function useInfiniteLane<P, C>(
  read: InfiniteLaneReadSpec<P, C>,
): InfiniteLaneResult<P, C>;
export function useInfiniteLane<P, C>(
  read: InfiniteLaneAnyReadSpec<P, C>,
): InfiniteLaneResult<P, C> {
  const { key, initialCursor, fetchPage, nextCursor } = read;

  // `loadMore` goes through `lane.update`, which never reaches `runLoader`, so
  // the resolved meta must be handed to that page fetch directly.
  const { lane, loaderMeta: laneMeta } = useLaneContext("useInfiniteLane");
  const keyId = serializeKey(key);
  const loaderMeta = read.loaderMeta ?? laneMeta;

  // The cursor walk, built only when the client owns the first page. `external`
  // is a real loader whose brand exists to steer the read spec's overloads;
  // here the choice has already been made, so both are the same thing to make.
  const loader: LaneLoader<InfiniteLaneValue<P, C>, InfiniteLaneValue<P, C>> =
    read.loader ??
    (async ({ current, meta, signal }) => {
      // A first load is one page deep.
      const depth = current?.pages.length ?? 1;
      const pages: P[] = [];
      const params: C[] = [];
      // Page 1 re-fetches from its original cursor: a changed `initialCursor`
      // cannot silently re-anchor an existing list. Absent only on the external
      // form, which never reaches this loader.
      let cursor: C = current?.params[0] ?? (initialCursor as C);
      let next: C | null = null;

      for (let index = 0; index < depth; index += 1) {
        const page = await fetchPage(cursor, { meta, signal });
        pages.push(page);
        params.push(cursor);

        // Only a *derived* cursor can end the walk: `null` is an ordinary
        // initial cursor, so it is never tested before the first fetch.
        next = nextCursor(page, cursor);

        if (next === null) {
          break;
        }

        cursor = next;
      }

      return { hasNext: next !== null, pages, params };
    });

  // The pagination fields ride along inert (`useLane` ignores options it does
  // not know) and `merge` rides along to the store, which is where a
  // publication meets the depth this list already has. A value rather than an
  // inline literal: `merge` is nothing a public read shape names, and an object
  // literal would be checked for exactly that.
  const spec = { ...read, loader, merge: mergeFirstPage };

  const {
    invalidate,
    isBackgroundPending,
    isInvalidationPending,
    promise,
    startInvalidationTransition,
  } = useLane<InfiniteLaneValue<P, C>>(spec);

  // Depends on `keyId`, not `key` (a fresh array every render). Never pin the
  // identity via a ref reading fresh values: during a pending transition a
  // click could land on a key not yet shown. Effect callers use `useEffectEvent`.
  const loadMore = useCallback(() => {
    return updateEntry<InfiniteLaneValue<P, C>>(lane, keyId, async (value) => {
      const lastPage = value.pages[value.pages.length - 1];
      const lastParam = value.params[value.params.length - 1];

      if (!value.hasNext || lastPage === undefined || lastParam === undefined) {
        // Unchanged value: structural sharing keeps the entry's identity, so an
        // over-eager caller costs only a notification.
        return value;
      }

      const cursor = nextCursor(lastPage, lastParam);

      if (cursor === null) {
        return { ...value, hasNext: false };
      }

      // No `signal`: an updater cannot be aborted; this runs to completion.
      const page = await fetchPage(cursor, { meta: loaderMeta });

      return {
        hasNext: nextCursor(page, cursor) !== null,
        pages: [...value.pages, page],
        params: [...value.params, cursor],
      };
    });
  }, [fetchPage, keyId, lane, loaderMeta, nextCursor]);

  return {
    invalidate,
    isBackgroundPending,
    isInvalidationPending,
    loadMore,
    promise,
    startInvalidationTransition,
  };
}

/**
 * What a publication does to a list the browser has already deepened — the one
 * merge policy Lane ships, and the reason {@link LaneMergePublication} exists.
 *
 * A route republishes page 1 on every navigation and every `refresh`. If it is
 * the page the list already starts with, the pages the browser fetched after it
 * are still the pages that follow it, so the list keeps its depth: the
 * published page 1, then the pages standing behind it, with the cursors and
 * `hasNext` that describe them. Anything else — a different page 1, or nothing
 * standing there at all (the store answers that one) — is a list the browser's
 * depth no longer describes, and the publication stands alone.
 *
 * Equality is `replaceEqualDeep`'s, the same notion the store shares refetched
 * values by: deep for arrays and plain objects, identity for everything else.
 */
const mergeFirstPage: LaneMergePublication = ({ held, published }) => {
  const incoming = asInfiniteValue(published);
  const standing = asInfiniteValue(held);

  // Nothing to keep: a list one page deep *is* the publication, and a value of
  // some other shape is not this list at all.
  if (!incoming || !standing || standing.pages.length < 2) {
    return published;
  }

  const first = incoming.pages[0];

  if (replaceEqualDeep(standing.pages[0], first) !== standing.pages[0]) {
    return published;
  }

  return {
    hasNext: standing.hasNext,
    pages: [first, ...standing.pages.slice(1)],
    params: standing.params,
  };
};

function asInfiniteValue(
  value: unknown,
): InfiniteLaneValue<unknown, unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    Array.isArray((value as InfiniteLaneValue<unknown, unknown>).pages)
    ? (value as InfiniteLaneValue<unknown, unknown>)
    : undefined;
}

/**
 * Colocate an infinite list's key, pagination, and read options — `laneRead`
 * for `useInfiniteLane`. Identity at runtime: `P` and `C` are inferred where
 * the list is defined, and the `key` is tagged with the accumulated
 * `InfiniteLaneValue`, so writes through it are checked against the whole list.
 *
 * The external form — first page from the route — comes first, so a spec that
 * declares `loader: external` lands on it.
 */
export function infiniteLaneRead<P, C>(
  spec: InfiniteLaneExternalReadSpec<P, C>,
): InfiniteLaneExternalReadSpec<P, C> & {
  key: LaneKeyOf<InfiniteLaneValue<P, C>>;
};
export function infiniteLaneRead<P, C>(
  spec: InfiniteLaneReadSpec<P, C>,
): InfiniteLaneReadSpec<P, C> & { key: LaneKeyOf<InfiniteLaneValue<P, C>> };
export function infiniteLaneRead<P, C>(
  spec: InfiniteLaneAnyReadSpec<P, C>,
): InfiniteLaneAnyReadSpec<P, C> & {
  key: LaneKeyOf<InfiniteLaneValue<P, C>>;
} {
  return spec as InfiniteLaneAnyReadSpec<P, C> & {
    key: LaneKeyOf<InfiniteLaneValue<P, C>>;
  };
}
