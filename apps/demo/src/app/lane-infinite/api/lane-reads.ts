import { laneKey } from "use-lane";
import type { InfiniteLaneValue, LaneKeyOf } from "use-lane";
import type { TaskPage } from "@/server/api";
import type { TaskPageFilters } from "./endpoints";

/**
 * **The one key this screen owns**, and the thing to notice is what is *not* in
 * it.
 *
 * The list is client-owned and the key names it: which filters, and nothing
 * else. No first-page version, no generation counter. An earlier revision of
 * this spike put the server's content hash in here — reset-via-key, which worked
 * and cost `.key` its reachability: with a runtime-derived segment, no mutation
 * helper, error-boundary retry, or Server Component can name the entry without
 * holding the current page. The identity of the first page is a *fact about the
 * value*, and `useHybridInfiniteLane` keeps it in component state where facts
 * about the value belong.
 *
 * `laneKey` tags it with what the entry holds — the accumulated list — so the
 * `lane.set` that resets it is type-checked against the whole value rather than
 * against one page.
 */
export type TaskListValue = InfiniteLaneValue<TaskPage, string | null>;

export function taskListKey(
  filters: TaskPageFilters,
): LaneKeyOf<TaskListValue> {
  return laneKey<TaskListValue>(["tasks-infinite", filters]);
}

/** Page 1 is the route's; its content hash is how the client knows it moved. */
export function taskPageVersion(page: TaskPage): string {
  return page.version;
}
