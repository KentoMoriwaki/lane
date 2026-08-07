import { external, laneRead, laneSnapshot } from "use-lane";
import type { LaneHydrationSnapshots } from "use-lane";
import type { TaskPage } from "@/server/api";
import type { TaskPageFilters } from "../api/endpoints";

/**
 * **The published variant's key.** Only this rig uses it; the main route has no
 * external key at all.
 *
 * A prop is the cheapest way to move page 1 from the route to the list, and
 * `/lane-infinite` uses it. This module exists for the case where a prop cannot
 * make the trip: the component that needs page 1 is not a descendant of the
 * component that loaded it, or it renders before the load has finished. Then
 * the value has to travel through the lane, and `external` is how a read says
 * "I am not the one who fills this".
 *
 * What does *not* change is the pattern on the other side. Once `use()` has
 * unwrapped the publication it is a `TaskPage` like any other, and it goes into
 * `useInfiniteLane`'s `firstPage` exactly as the prop does. That is the point of
 * the variant: `firstPage` is about the value, not about how it arrived, and
 * delivery and convergence are independent concerns.
 */
export const publishedFirstPage = (filters: TaskPageFilters) =>
  laneRead<TaskPage>({
    key: ["published-page1", filters],
    loader: external,
  });

export function publishedFirstPageSnapshots(
  filters: TaskPageFilters,
  firstPage: TaskPage,
): LaneHydrationSnapshots {
  return {
    entries: [laneSnapshot(publishedFirstPage(filters), firstPage)],
  };
}
