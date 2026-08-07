import {
  external,
  infiniteLaneRead,
  laneRead,
  laneSnapshot,
} from "use-lane";
import type {
  InfiniteLaneReadSpec,
  InfiniteLaneValue,
  LaneHydrationSnapshots,
  LaneKeyOf,
  LaneLoaderMeta,
} from "use-lane";
import type { TaskPage } from "@/server/api";
import type { TaskPageFilters } from "./endpoints";

/**
 * **The hybrid-ownership spike, in one module.**
 *
 * One screen, two owners, two keys — and the whole point is that the seam
 * between them is a value, not a hook:
 *
 * - `["tasks-page1", filters]` is **server-owned**. The route loads page 1 with
 *   the same endpoint the browser paginates with and publishes it through
 *   `<LaneHydration>`; the browser reads it with `loader: external` and never
 *   fetches it.
 * - `["tasks-infinite", filters]` is **client-owned**. `useInfiniteLane` walks
 *   the cursor chain on it, `loadMore` appends through `update`, and a
 *   republication invalidates it.
 *
 * They are two keys because they *have* to be. `loadMore` appends through
 * `lane.update`, and `update` on a seeded key throws `LaneOwnershipError` — so
 * "seed the infinite key and then paginate it" is the one configuration Lane
 * refuses (see `docs/architectures.md`). What this pattern does instead is
 * keep the ownership split intact and cross it in the only place a client-owned
 * read is allowed to read anything: inside its own loader. Page 1's fetch is
 * not a fetch at all — it is `await` on the published promise.
 *
 * No `"use client"`: the Server Component builds `taskPageSnapshots` from
 * `taskPageReads.firstPage`, and the browser reads the very same read. A
 * `laneSnapshot` of a read is checked against the read's `T`, which is what
 * stops the two halves drifting into "the server publishes a `Task[]`, the
 * client's `fetchPage` returns a `TaskPage`" — a mismatch nothing else would
 * catch, because it does not fail a fetch, it just seeds the wrong shape.
 */
export const taskPageReads = {
  /**
   * Page 1, as the route published it. `T` is written out because an external
   * read has no loader to infer it from — the one cost of the form.
   */
  firstPage: (filters: TaskPageFilters) =>
    laneRead<TaskPage>({
      key: ["tasks-page1", filters],
      loader: external,
    }),
};

/** What the infinite loader is given for each of its two page sources. */
export type TaskPageSource = {
  /**
   * Page 1. The client hands in `externalPromise.then((read) => read.data)` —
   * the published value, adopted rather than fetched.
   *
   * It is a *thunk* rather than the promise itself so the branch reads the same
   * as the other one, and so nothing is chained until the walk actually reaches
   * page 1. The identity that matters (the publication's) is captured by the
   * closure the caller builds, and the caller re-builds it whenever that
   * identity changes — which is the whole convergence mechanism.
   */
  firstPage: () => Promise<TaskPage>;
  /** Pages 2..N: an ordinary client fetch, with the read's abort signal. */
  nextPage: (
    cursor: string,
    context: { signal?: AbortSignal; meta: LaneLoaderMeta },
  ) => Promise<TaskPage>;
};

/**
 * The client-owned infinite read, assembled from the two page sources.
 *
 * The cursor type is `string | null` and `initialCursor` is `null`, so "page 1"
 * is expressible as a value the loader can branch on. That is the entire
 * mechanism: `cursor === null` means *the page somebody else owns*, and every
 * other cursor means *a page this client owns*.
 *
 * Note what is **not** here: any freshness option. A `staleTime` /
 * `refetchOnFocus` on this key would refetch page 1 from a publication that
 * may have been superseded, or from one this reader has no way to ask for. The
 * only thing allowed to move page 1 is a new publication, and the route is what
 * produces one.
 */
export function taskInfiniteRead(
  filters: TaskPageFilters,
  source: TaskPageSource,
): InfiniteLaneReadSpec<TaskPage, string | null> & {
  key: LaneKeyOf<InfiniteLaneValue<TaskPage, string | null>>;
} {
  return infiniteLaneRead({
    fetchPage: (cursor, context) =>
      cursor === null ? source.firstPage() : source.nextPage(cursor, context),
    initialCursor: null as string | null,
    key: ["tasks-infinite", filters],
    nextCursor: (page) => page.nextCursor,
  });
}

/**
 * The per-request seed. One entry: the route owns page 1 and nothing else, and
 * the depth below it belongs to the browser.
 */
export function taskPageSnapshots(
  filters: TaskPageFilters,
  firstPage: TaskPage,
): LaneHydrationSnapshots {
  return {
    entries: [laneSnapshot(taskPageReads.firstPage(filters), firstPage)],
  };
}
