"use client";

import { useCallback } from "react";
import { updateEntry } from "./core";
import { serializeKey } from "./keys";
import { useLaneInstance } from "./provider";
import type {
  LaneInvalidateOptions,
  LaneKey,
  LaneRead,
  LaneUseOptions,
} from "./types";
import { useLane } from "./use-lane";

/**
 * What one key holds for an infinite list: every page loaded so far, the cursor
 * each was fetched with, and whether the server said there is more.
 *
 * `hasNext` lives *in the value* rather than on the hook result for the same
 * reason `refreshError` does: the hook hands back a promise it never resolves,
 * so it cannot know. Keeping it here also makes it impossible for `hasNext` and
 * `pages` to disagree mid-render under concurrent rendering — they arrive
 * together or not at all. The split is the rule for this hook: **actions come
 * from the hook, data comes from `use(promise)`.**
 *
 * `params` is not bookkeeping for its own sake. It is what makes a re-read
 * reproducible: page 1 is re-fetched from the cursor it originally used, and
 * every later cursor is re-derived from the page that just came back.
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
   * Fetch one page. `signal` is present on the refresh path (it is the read's
   * abort signal) and absent on the `loadMore` path — `lane.update` hands an
   * updater the current value, not a signal, so an appended page genuinely
   * cannot be aborted. It is optional rather than faked so the difference is
   * visible at the call site.
   */
  fetchPage: (cursor: C, context: { signal?: AbortSignal }) => Promise<P>;
  /** The cursor for the page after this one, or `null` at the end of the list. */
  nextCursor: (page: P, cursor: C) => C | null;
};

export type InfiniteLaneResult<P, C> = {
  promise: Promise<LaneRead<InfiniteLaneValue<P, C>>>;
  /**
   * Fetch the page after the last one and append it. No-op at the end of the
   * list.
   *
   * Returns the entry's next promise, so a caller that is not driving off the
   * rendered value can await the outcome — an auto-load effect, typically. It
   * resolves rather than rejects when the page fails, like any read: check
   * `refreshError` on the result, and stop the trigger while it is set.
   * `undefined` means there was nothing to append to (no entry yet, or its last
   * read rejected).
   */
  loadMore: () => Promise<LaneRead<InfiniteLaneValue<P, C>>> | undefined;
  isTransitionPending: boolean;
  isBackgroundPending: boolean;
  invalidate: (options?: LaneInvalidateOptions) => void;
};

/**
 * Read a cursor-paginated list as **one key holding the whole accumulated
 * list** — `useLane` with a loader that knows how deep it already is.
 *
 * The depth is not in the key and not in component state: it is read from
 * `current` (the entry's last fulfilled value) at load time. That is the whole
 * design. A key that encoded the page count would make every depth a different
 * cached list; a depth held in a ref would desync the moment the component
 * remounted over a cache that outlived it — the reader would believe it had one
 * page while the screen showed five, and the next invalidation would silently
 * truncate the list. Sourcing it from the value makes "re-read what I have" an
 * identity, not a promise the caller has to keep.
 *
 * Two paths write to that value, and they cost very different things:
 *
 * - **`loadMore`** is a `lane.update`: one request, appended. The key never
 *   changes, so the reader converges through a transition and the list stays on
 *   screen — no `useTransition` of your own.
 * - **A re-read** (invalidate, focus, mount, poll) re-walks the cursor chain
 *   from the start, as deep as the value already is, **sequentially** — page
 *   N+1's cursor only exists once page N has come back. Refreshing a list five
 *   pages deep is five round trips, and there is no way around it that keeps the
 *   cursors honest.
 *
 * If a re-derived cursor comes back `null` before the walk reaches its old
 * depth, the walk stops there and the list is shorter than it was. That is the
 * list actually shrinking — rows were deleted underneath it — and it is
 * deliberately not papered over.
 *
 * ```tsx
 * const { promise, loadMore, isTransitionPending } = useInfiniteLane(
 *   ["feed", filters],
 *   {
 *     initialCursor: null as string | null,
 *     fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
 *     nextCursor: (page) => page.nextCursor,
 *   },
 * );
 *
 * const { data, refreshError } = use(promise);
 * // data.pages / data.hasNext — never a status object.
 * ```
 */
export function useInfiniteLane<P, C>(
  key: LaneKey,
  options: InfiniteLaneOptions<P, C>,
  readOptions?: LaneUseOptions,
): InfiniteLaneResult<P, C> {
  const lane = useLaneInstance();
  const keyId = serializeKey(key);

  const { initialCursor, fetchPage, nextCursor } = options;

  const { invalidate, isBackgroundPending, isTransitionPending, promise } =
    useLane<InfiniteLaneValue<P, C>>(
      key,
      async ({ current, signal }) => {
        // `current` is typed by the explicit type argument above, so this reads
        // the accumulated value directly — no narrowing, no cast.
        // How deep this key already is. A first load is one page.
        const depth = current?.pages.length ?? 1;
        const pages: P[] = [];
        const params: C[] = [];
        // Page 1 is re-fetched from the cursor it originally used, so an
        // `initialCursor` that changed identity between renders cannot silently
        // re-anchor an existing list.
        let cursor: C = current?.params[0] ?? initialCursor;
        let next: C | null = null;

        for (let index = 0; index < depth; index += 1) {
          const page = await fetchPage(cursor, { signal });
          pages.push(page);
          params.push(cursor);

          // Only a *derived* cursor can end the walk. The first one is whatever
          // the caller nominated — `null` is a perfectly ordinary "start here"
          // for an API where the first page carries no cursor, and testing it
          // before the first fetch would load nothing at all.
          next = nextCursor(page, cursor);

          if (next === null) {
            // The list is shorter than it was: a cursor that used to yield
            // another page no longer does.
            break;
          }

          cursor = next;
        }

        return { hasNext: next !== null, pages, params };
      },
      readOptions,
    );

  // `useCallback` with its real dependencies — no more, and nothing suppressed.
  // Addressing the entry by `keyId` rather than `key` is what keeps the list
  // honest: `key` is a fresh array every render, so depending on it would defeat
  // the memo, and closing over it without depending on it would be a lie. This
  // is the same shape `useLane`'s `invalidate` already has.
  //
  // So the callback is stable exactly when the caller's page functions are (the
  // React Compiler, or a caller that memoizes) and correctly *not* stable when
  // they are not. What it must never do is pin its identity harder than the
  // inputs justify: any scheme that keeps one identity while still reading fresh
  // values (a ref, an effect-refreshed ref, a render-phase write) smuggles state
  // past React — during a pending transition the committed tree the user is
  // clicking and the tree such a ref describes are different, so a click lands
  // on a key that has not been shown yet. Nothing needs that anyway. An
  // `onClick` does not care about identity, and a caller driving this from an
  // effect (a scroll sentinel) wraps it in `useEffectEvent` on their side.
  const loadMore = useCallback(() => {
    return updateEntry<InfiniteLaneValue<P, C>>(lane, keyId, async (value) => {
      const lastPage = value.pages[value.pages.length - 1];
      const lastParam = value.params[value.params.length - 1];

      if (!value.hasNext || lastPage === undefined || lastParam === undefined) {
        // Returning the value unchanged keeps the entry's identity (structural
        // sharing collapses it), so an over-eager caller costs a notification
        // and nothing else. Gate the control on `data.hasNext` to skip even
        // that.
        return value;
      }

      const cursor = nextCursor(lastPage, lastParam);

      if (cursor === null) {
        return { ...value, hasNext: false };
      }

      // No `signal`: an updater is handed the current value, not an abort
      // controller, so this request runs to completion even if the reader
      // moves on.
      const page = await fetchPage(cursor, {});

      return {
        hasNext: nextCursor(page, cursor) !== null,
        pages: [...value.pages, page],
        params: [...value.params, cursor],
      };
    });
  }, [fetchPage, keyId, lane, nextCursor]);

  return {
    invalidate,
    isBackgroundPending,
    isTransitionPending,
    loadMore,
    promise,
  };
}
