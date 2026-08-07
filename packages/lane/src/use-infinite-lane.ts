"use client";

import { useCallback, useLayoutEffect } from "react";
import {
  adoptFirstPage,
  dropFirstPageFork,
  firstPageFork,
  updateEntry,
} from "./core";
import { serializeKey } from "./keys";
import { useLaneContext } from "./provider";
import type {
  LaneInvalidate,
  LaneKey,
  LaneKeyOf,
  LaneLoaderMeta,
  LaneRead,
  LaneStartInvalidationTransition,
  LaneUseOptions,
} from "./types";
import { useLaneRead } from "./use-lane";

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

/**
 * A first page somebody else already loaded, and the identity of what is in it.
 *
 * Both halves are required and neither means anything alone, which is why they
 * are one option rather than two: a value with no identity cannot be compared
 * against the one the list already starts with, and an identity with no value
 * has nothing to start from.
 *
 * `version` must be **content** identity, computed by whoever owns the page —
 * equal when the page is the same, different when it is not. Reference identity
 * cannot stand in for it: a value that arrives as an RSC prop or a router
 * loader's data is deserialized afresh on every delivery, so `===` says
 * "different" every time and the list would reset on every refresh. A hash of
 * the rows, or a version the source already has, is the thing to ship.
 *
 * Provenance must stay *out* of it. If `version` covers a served-at timestamp or
 * a request id, then every refresh is a new version and the option inverts into
 * "throw the user's depth away whenever anything reloads".
 */
export type InfiniteLaneFirstPage<P> = {
  value: P;
  version: string;
};

export type InfiniteLaneOptions<P, C> = {
  /**
   * The cursor the first page is fetched with.
   *
   * Still required with {@link firstPage}, where nothing is fetched with it: it
   * is what `params[0]` records — the cursor the page's owner loaded it at on
   * this client's behalf — and it is the only place `C` can be inferred from.
   * (`fetchPage` and `nextCursor` are both context-sensitive, so inference from
   * them depends on the order the properties happen to be written in, which is
   * not an API. See the note on the `firstPage` option.)
   */
  initialCursor: C;
  /**
   * **Page 1, already loaded, from an owner that is not this client.**
   *
   * The shape this exists for is one screen with two owners: a route (or a
   * router loader) owns the first page — it is what the URL is about, it belongs
   * in the first paint, and it changes when the owner republishes — while the
   * *depth* below it belongs to the browser, because how far someone has
   * scrolled is not something a server render knows. Neither key may be written
   * by the other side, so the first page cannot simply be seeded into this one:
   * `loadMore` appends through `update`, and `update` on a published key throws.
   *
   * With `firstPage` present, walk index 0 **is** this value. `fetchPage` is
   * never called for it, on a first load or on a re-walk, and `nextCursor` reads
   * the chain's second cursor off it as usual. So a list five pages deep costs
   * four requests to refresh, not five, and a first paint costs none.
   *
   * ### What a new `version` does
   *
   * A different `version` is a different list. The render that receives it
   * **forks**: it returns a resolved, depth-1 promise built from the new page
   * while leaving the entry alone, and the commit that shows it adopts it as the
   * entry's value. The list resets to depth 1, costs zero requests, and — this
   * is the property worth protecting — the commit that first shows the new page
   * is the same commit that shows the reset list. No frame mixes them.
   *
   * An *equal* `version` does nothing at all. That is what keeps depth across a
   * republication that changed nothing, an `<Activity>` reveal, or a
   * `router.refresh()` over a warm cache: the page is the one the list already
   * starts with, so there is nothing to converge.
   *
   * Pages 2..N are discarded by a reset rather than re-derived. That is the
   * trade the option makes deliberate — a changed first page means every cursor
   * below it may have moved, and re-walking them is both slower and a guess. Ask
   * for the walk explicitly with `invalidate` when it is what you want.
   *
   * ### Two things it does not do
   *
   * **`invalidate` cannot refresh page 1.** A re-walk takes page 1 from the
   * latest `firstPage` this component rendered with, for free, and refetches
   * pages 2..N. That is a *half* refresh by construction: page 1 belongs to its
   * owner, so making it current means asking the owner to deliver a new one
   * (a route revalidation, a router reload) — Lane has no channel to it.
   *
   * **The value is not protected from local writes.** Once adopted it lives in a
   * client-owned entry like any other page, so `lane.set` / `lane.update` on
   * this key can rewrite content this client does not own. Nothing throws; the
   * next `version` change overwrites whatever was written. Treat the accumulated
   * list as read-plus-append, which is all `loadMore` does.
   */
  firstPage?: InfiniteLaneFirstPage<P>;
  /**
   * Fetch one page. `signal` is present on the refresh path (it is the read's
   * abort signal) and absent on the `loadMore` path — `lane.update` hands an
   * updater the current value, not a signal, so an appended page genuinely
   * cannot be aborted. It is optional rather than faked so the difference is
   * visible at the call site.
   *
   * Never called for page 1 when {@link firstPage} is supplied.
   */
  fetchPage: (
    cursor: C,
    context: { signal?: AbortSignal; meta: LaneLoaderMeta },
  ) => Promise<P>;
  /** The cursor for the page after this one, or `null` at the end of the list. */
  nextCursor: (page: P, cursor: C) => C | null;
};

/**
 * An infinite read described in one place — the colocated form of
 * `useInfiniteLane`, and the same idea as {@link LaneReadSpec} for a list whose
 * loader is a cursor walk rather than a single fetch. The pagination options,
 * the key, and the read options travel together; build one with
 * {@link infiniteLaneRead}.
 */
export type InfiniteLaneReadSpec<P, C> = LaneUseOptions &
  InfiniteLaneOptions<P, C> & {
    key: LaneKey;
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
  isInvalidationPending: boolean;
  isBackgroundPending: boolean;
  /** The bound, awaitable `invalidate` — see {@link LaneInvalidate}. */
  invalidate: LaneInvalidate<InfiniteLaneValue<P, C>>;
  startInvalidationTransition: LaneStartInvalidationTransition;
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
 * const { promise, loadMore, isInvalidationPending } = useInfiniteLane({
 *   key: ["feed", filters],
 *   initialCursor: null as string | null,
 *   fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
 *   nextCursor: (page) => page.nextCursor,
 * });
 *
 * const { data, refreshError } = use(promise);
 * // data.pages / data.hasNext — never a status object.
 * ```
 */
export function useInfiniteLane<P, C>(
  read: InfiniteLaneReadSpec<P, C>,
): InfiniteLaneResult<P, C> {
  const { key, firstPage, initialCursor, fetchPage, nextCursor } = read;

  // `loadMore` appends through `lane.update`, which is not a read and so never
  // reaches `runLoader` — the meta the refresh path gets from the read options
  // has to be handed to that page fetch directly, resolved the same way.
  const { lane, loaderMeta: laneMeta } = useLaneContext("useInfiniteLane");
  const keyId = serializeKey(key);
  const loaderMeta = read.loaderMeta ?? laneMeta;

  const {
    invalidate,
    isBackgroundPending,
    isInvalidationPending,
    promise,
    startInvalidationTransition,
  } =
    // The read options pass straight through; the pagination fields ride along
    // inert (a read only ever looks at the four it knows) except
    // `firstPageVersion`, which the store stamps on the entry if — and only if —
    // this call is what starts the read.
    useLaneRead<InfiniteLaneValue<P, C>>({
      ...read,
      firstPageVersion: firstPage?.version,
      loader: async ({ current, meta, signal }) => {
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
          // Index 0 is the owner's page when there is one, and the walk simply
          // does not have a request to make for it — on a first load or on a
          // re-walk five pages deep. `params[0]` still records `initialCursor`,
          // which is the cursor the owner loaded that page at.
          const page =
            index === 0 && firstPage
              ? firstPage.value
              : await fetchPage(cursor, { meta, signal });
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
    });

  /**
   * The fork, and the two commits that end it.
   *
   * Read *after* `useLane`, never before, and the order is the whole
   * correctness argument: a first load is `useLane`'s `readOrCreate` creating
   * the entry and stamping this very version on it, so by this line a mount
   * already agrees with itself and forks nothing. What reaches the branch is
   * only the case the option exists for — an entry that already holds a list,
   * built from a first page that is no longer the one being handed down.
   *
   * Nothing here is a hook, and that is deliberate: `useState` and `useMemo` are
   * thrown away when a render suspends, so either would build a second promise
   * on the retry and suspend on that one too. The store is the only place a
   * value can survive a render that never commits.
   */
  const forked = firstPage
    ? firstPageFork<InfiniteLaneValue<P, C>>(
        lane,
        keyId,
        firstPage.version,
        () => ({
          hasNext: nextCursor(firstPage.value, initialCursor) !== null,
          pages: [firstPage.value],
          params: [initialCursor],
        }),
      )
    : undefined;
  // The fork's job is done the moment `useLane`'s own state *is* the fork —
  // which only happens once the adoption's notification has been rendered.
  const settled = forked !== undefined && forked === promise;
  const version = firstPage?.version;

  // A layout effect, because this is a commit deciding what is on screen before
  // paint — the same reason `useLane` reconciles a reveal from one. It runs
  // after `useLane`'s (that hook is called first, so its effects are registered
  // first), which is what puts this reader inside the subscriber set before the
  // adoption notifies: the notification is how its `useLane` — still holding the
  // pre-fork promise — moves across to the promise this render already returned.
  useLayoutEffect(() => {
    if (version === undefined) {
      return;
    }

    if (settled) {
      dropFirstPageFork(lane, keyId, version);
      return;
    }

    adoptFirstPage(lane, keyId, version);
  }, [lane, keyId, version, settled]);

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
    // The fork is what this render shows, for the one render between receiving a
    // new first page and the commit that adopts it. Every render after that gets
    // the entry's promise back — and it is the *same object*, because adoption
    // installs the fork itself rather than a copy of its value, so the swap
    // costs no re-suspension and no re-render of anything reading the value.
    promise: forked ?? promise,
    startInvalidationTransition,
  };
}

/**
 * Colocate an infinite list's key, pagination, and read options — `laneRead` for
 * `useInfiniteLane`.
 *
 * ```ts
 * export const feedLanes = {
 *   list: (filters: Filters) =>
 *     infiniteLaneRead({
 *       key: ["feed", filters],
 *       initialCursor: null as string | null,
 *       fetchPage: (cursor, { signal }) => fetchFeed({ cursor, filters, signal }),
 *       nextCursor: (page) => page.nextCursor,
 *       staleTime: 30_000,
 *     }),
 * };
 *
 * const { promise, loadMore } = useInfiniteLane(feedLanes.list(filters));
 * lane.invalidate(feedLanes.list(filters).key); // the key travels with it
 * ```
 *
 * Identity at runtime, like `laneRead`: what it buys is that `P` and `C` are
 * inferred and checked where the list is defined — `nextCursor` must return the
 * cursor `fetchPage` takes — instead of at each call site. Its `key` is tagged
 * with the accumulated `InfiniteLaneValue`, so `lane.set` / `lane.update`
 * through it are checked against the whole list rather than one page.
 */
export function infiniteLaneRead<P, C>(
  spec: InfiniteLaneReadSpec<P, C>,
): InfiniteLaneReadSpec<P, C> & { key: LaneKeyOf<InfiniteLaneValue<P, C>> } {
  // The key is tagged with what the *entry* holds — the accumulated list, not
  // one page — so a write through it is checked against the whole value.
  return spec as InfiniteLaneReadSpec<P, C> & {
    key: LaneKeyOf<InfiniteLaneValue<P, C>>;
  };
}
