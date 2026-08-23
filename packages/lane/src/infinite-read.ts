// No `"use client"` here, on purpose — and it is the reason this module exists
// apart from `use-infinite-lane.ts`. A Server Component builds an infinite read
// to publish its first page (`infiniteLaneSnapshot(read, page, cursor)`), and a
// function that lives in a client module cannot be *called* from the server,
// only rendered. `infiniteLaneRead` is identity at runtime, like `laneRead`, so
// it belongs with the other isomorphic builders; the hook imports its types
// from here.
import type {
  LaneExternalLoader,
  LaneKey,
  LaneKeyOf,
  LaneLoaderMeta,
  LaneUseOptions,
} from "./types";

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
 * freshness options, exactly as on `LaneExternalReadSpec` — freshness is the
 * owner's. `fetchPage` / `nextCursor` stay required: `loadMore` is the client's
 * half of this list.
 */
export type InfiniteLaneExternalReadSpec<P, C> = Omit<
  InfiniteLaneOptions<P, C>,
  "initialCursor"
> & {
  key: LaneKey;
  loader: LaneExternalLoader;
};

/** Every shape the hook accepts; the hook's body branches on the loader, once. */
export type InfiniteLaneAnyReadSpec<P, C> = LaneUseOptions &
  Omit<InfiniteLaneOptions<P, C>, "initialCursor"> & {
    key: LaneKey;
    initialCursor?: C;
    loader?: LaneExternalLoader;
  };

/**
 * Colocate an infinite list's key, pagination, and read options — `laneRead`
 * for `useInfiniteLane`. Identity at runtime: `P` and `C` are inferred where
 * the list is defined, and the `key` is tagged with the accumulated
 * `InfiniteLaneValue`, so writes through it are checked against the whole list.
 *
 * Callable from a Server Component (this module carries no `"use client"`),
 * which is how a route builds the read it publishes page 1 under.
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
