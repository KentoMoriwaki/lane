import { Suspense } from "react";
import {
  FilterBarRegion,
  InsightStripRegion,
  SidebarRegion,
  TaskListRegion,
} from "./regions";
import { WorkspaceBrand } from "@/app/lane/workspace/brand";
import {
  FilterBarSkeleton,
  InsightStripSkeleton,
  SidebarSkeleton,
  TaskListSkeleton,
} from "@/app/lane/workspace/skeletons";
import { Workspace } from "@/app/lane/workspace/workspace";

// The route claims its navigations produce a UI immediately. Nothing below may
// await above a Suspense boundary, or the claim fails validation.
export const instant = true;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * **The server-owned variant.** Every workspace key is published by this route
 * and read with `external` — a loader that waits for the publication rather
 * than fetching anything itself.
 *
 * This component awaits nothing, which is the whole point. `searchParams` and
 * every read are resolved inside the regions, below their own boundaries, so
 * the frame and each region's fallback are static: that composition *is* the
 * App Shell, prerendered by the framework rather than written by hand. A
 * navigation paints it immediately and each region streams in as its own read
 * lands — the task list at its own latency, not the slowest read's.
 *
 * **The detail is not here any more.** A task is its own route
 * (`task/[id]/page.tsx`), and a row is a `<Link>` to it. Clicking one is
 * intercepted into the `@modal` slot, which `layout.tsx` draws beside this
 * list; opening the same URL directly renders the full page instead. So this
 * file publishes the list's keys and nothing else, and the panel's empty state
 * is `@modal/default.tsx` — literally nothing rendered.
 *
 * Mutations arrive by two channels, and only one of them ends here. Creating
 * something calls a Server Action, whose response *is* this route rendered
 * again — the new task comes back already in its sorted place. Editing a task
 * calls the API from the browser and lands the whole answer in the lane: the
 * row, and the counters the write recomputed after it. **That channel never
 * renders this file.** Neither needs the other to know what it did (see
 * `api/hooks.ts`).
 *
 * `/lane-spa` is the same workspace with the opposite answer: no seeding,
 * client loaders, and the cache maintenance that comes with owning your data.
 */
export default function Page({ searchParams }: PageProps) {
  return (
    <Workspace
      sidebar={
        <Suspense fallback={<SidebarSkeleton brand={<WorkspaceBrand />} />}>
          <SidebarRegion searchParams={searchParams} />
        </Suspense>
      }
      insights={
        <Suspense fallback={<InsightStripSkeleton />}>
          <InsightStripRegion searchParams={searchParams} />
        </Suspense>
      }
      filterBar={
        <Suspense fallback={<FilterBarSkeleton />}>
          <FilterBarRegion searchParams={searchParams} />
        </Suspense>
      }
      taskList={
        <Suspense fallback={<TaskListSkeleton />}>
          <TaskListRegion searchParams={searchParams} />
        </Suspense>
      }
    />
  );
}
