"use client";

import { useCallback } from "react";
import { updateEntry } from "./core";
import { serializeKey } from "./keys";
import { useLaneContext } from "./provider";
import type {
  LaneInvalidate,
  LaneLoader,
  LaneRead,
  LaneStartInvalidationTransition,
} from "./types";
import { useLane } from "./use-lane";
// The read's shape and its builder live in `infinite-read.ts`, a module with
// no `"use client"`: a Server Component calls `infiniteLaneRead` to publish a
// first page, and a client module's function cannot be called from the server.
import type {
  InfiniteLaneAnyReadSpec,
  InfiniteLaneExternalReadSpec,
  InfiniteLaneReadSpec,
  InfiniteLaneValue,
} from "./infinite-read";

export type {
  InfiniteLaneExternalReadSpec,
  InfiniteLaneOptions,
  InfiniteLaneReadSpec,
  InfiniteLaneValue,
} from "./infinite-read";

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

  // The first page, and only ever the first page. `external` is a real loader
  // whose brand exists to steer the read spec's overloads; here the choice has
  // already been made, so both are the same thing to make.
  //
  // A load is what fills an entry that holds nothing — a first read, a read
  // after `invalidate`, a read after collection — and this one answers it with
  // the list as it starts. The depth on top of it belongs to `loadMore`, which
  // is the browser's alone: nothing but a `loadMore` ever puts a second page
  // under this key, so nothing but a `loadMore` puts one back.
  //
  // Reproducing the depth instead would mean walking the cursor chain, which is
  // one *sequential* request per page — page N+1's cursor does not exist until
  // page N is back — on a path that also fires from `refetchOnFocus` and the
  // rest. An app that wants the pages it is showing read again can say so, in
  // its own code and at its own cost: `invalidate()`, then `loadMore()` for the
  // depth it wants back. And the external form could not have joined in either
  // way: the owner publishes the first page, and that publication replaces the
  // key. One rule for both, and the expensive thing has a caller.
  const loader: LaneLoader<InfiniteLaneValue<P, C>, InfiniteLaneValue<P, C>> =
    read.loader ??
    (async ({ meta, signal }) => {
      const cursor = initialCursor as C;
      const page = await fetchPage(cursor, { meta, signal });

      return {
        // Only a *derived* cursor can end the list: `null` is an ordinary
        // initial cursor, so it is never tested before the first fetch.
        hasNext: nextCursor(page, cursor) !== null,
        pages: [page],
        params: [cursor],
      };
    });

  // The pagination fields ride along inert: `useLane` ignores options it does
  // not know.
  const spec = { ...read, loader };

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

