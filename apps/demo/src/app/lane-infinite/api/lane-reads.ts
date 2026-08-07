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
 * **The fork-and-extend read**, now that Lane owns the pattern.
 *
 * The screen has two owners. The route owns page 1: it loads it, it decides
 * when it changes, and it hands it over as an ordinary prop. The browser owns
 * the depth below it — `useInfiniteLane` walks the cursor chain from page 2 on
 * a key nobody seeds.
 *
 * `firstPage` is the whole seam. The value goes in with the content identity the
 * server computed for it, and Lane does the rest: page 1 is never fetched, an
 * unchanged `version` leaves the user's depth alone, and a changed one resets
 * the list to depth 1 in the same commit that first shows the new page.
 *
 * The key is back to naming the list and nothing else. The spike that led here
 * spliced `firstPage.version` into it — reset-via-key in userland — which worked
 * and cost `.key` its reachability: no mutation helper, error-boundary retry, or
 * Server Component could name the entry without holding the current page. The
 * option keeps the identity out of the key and inside the entry, where it
 * belongs.
 */

/** Pages 2..N — the only pages this client fetches. */
export type TaskPageFetcher = (
  cursor: string,
  context: { signal?: AbortSignal; meta: LaneLoaderMeta },
) => Promise<TaskPage>;

export function taskInfiniteRead(
  filters: TaskPageFilters,
  firstPage: TaskPage,
  nextPage: TaskPageFetcher,
): InfiniteLaneReadSpec<TaskPage, string> & {
  key: LaneKeyOf<InfiniteLaneValue<TaskPage, string>>;
} {
  return infiniteLaneRead({
    key: ["tasks-infinite", filters],
    // The cursor page 1 was loaded at — by the route, on this client's behalf.
    // Nothing is fetched with it; it is what `params[0]` records, and the only
    // place the cursor type can be inferred from.
    initialCursor: "",
    firstPage: { value: firstPage, version: firstPage.version },
    fetchPage: (cursor, context) => nextPage(cursor, context),
    nextCursor: (page) => page.nextCursor,
  });
}
