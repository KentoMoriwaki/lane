import { infiniteLaneRead } from "use-lane";
import type {
  InfiniteLaneReadSpec,
  InfiniteLaneValue,
  LaneKeyOf,
  LaneLoaderMeta,
} from "use-lane";
import type { TaskPage } from "@/server/api";
import type { TaskPageFilters } from "./endpoints";

/**
 * **The fork-and-extend read, in its value form.**
 *
 * The screen has two owners. The route owns page 1: it loads it, it decides
 * when it changes, and it hands it over — as an ordinary prop, resolved, no
 * ceremony. The browser owns the depth below it: `useInfiniteLane` walks the
 * cursor chain from page 2 on a key nobody seeds.
 *
 * Two things about the shape below carry the whole design.
 *
 * **Page 1 is a value the loader returns, not a fetch it performs.**
 * `Promise.resolve(firstPage)` is the entire page-1 branch. There is no request,
 * no publication to wait on, and nothing to converge — the route already did
 * all of it, and the loader is just handing back what it was given.
 *
 * **The fork's origin is in the key.** `firstPage.version` is the server's hash
 * of page 1's content, so the key *is* "the list that starts with this exact
 * page". A republication that changed page 1 changes the version, which changes
 * the key, which is a different list — Lane reads the new entry during render,
 * inside whatever transition the action or navigation is already running, and
 * the loader resolves it from the prop in a microtask. A republication that
 * changed nothing keeps the version, keeps the key, and keeps the user's depth.
 *
 * That last sentence is the part worth dwelling on, because the alternative
 * (watch the incoming page for change and `invalidate`) is what this replaced:
 * an effect, a two-dimensional guard against filter changes and `<Activity>`
 * reveals, and an N−1 request re-walk on every republication including the ones
 * that changed nothing. Reset-via-key has none of those moving parts. What it
 * gives up is continuity — a changed page 1 discards pages 2..N rather than
 * re-deriving them — and that is a product decision the key makes visible
 * instead of a policy buried in an effect.
 *
 * No `"use client"`: this is a plain object factory, importable from either
 * graph.
 */

/** Pages 2..N — the only pages this client fetches. */
export type TaskPageFetcher = (
  cursor: string,
  context: { signal?: AbortSignal; meta: LaneLoaderMeta },
) => Promise<TaskPage>;

export function taskInfiniteRead(
  filters: TaskPageFilters,
  firstPage: TaskPage,
  io: {
    nextPage: TaskPageFetcher;
    /**
     * Lab instrumentation, not part of the pattern: fires each time the loader
     * actually produces page 1, which is the only way to tell an entry that was
     * re-read from one that was reused.
     */
    onAdoptFirstPage?: (page: TaskPage) => void;
  },
): InfiniteLaneReadSpec<TaskPage, string | null> & {
  key: LaneKeyOf<InfiniteLaneValue<TaskPage, string | null>>;
} {
  return infiniteLaneRead({
    fetchPage: (cursor, context) => {
      // The sentinel is the one thing userland still cannot avoid: `cursor` is
      // the only channel the loader has for "which page is this", so page 1 has
      // to be expressible as a cursor value even though it is not fetched by
      // one. An API whose first page is `""` or `0` would have to widen `C`
      // purely to make room for it.
      if (cursor === null) {
        io.onAdoptFirstPage?.(firstPage);
        return Promise.resolve(firstPage);
      }

      return io.nextPage(cursor, context);
    },
    initialCursor: null as string | null,
    // `filters` says which list; `version` says which generation of it.
    key: ["tasks-infinite", filters, firstPage.version],
    nextCursor: (page) => page.nextCursor,
  });
}
