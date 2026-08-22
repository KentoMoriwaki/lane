import { Suspense } from "react";
import { getSession } from "@/app/lane/api/session";
import {
  FilterBarRegion,
  InsightStripRegion,
  SidebarRegion,
  TaskDetailRegion,
  TaskListRegion,
} from "./regions";
import { WorkspaceBrand } from "@/app/lane/workspace/brand";
import {
  DetailPanelSkeleton,
  FilterBarSkeleton,
  InsightStripSkeleton,
  SidebarSkeleton,
  TaskListSkeleton,
} from "@/app/lane/workspace/skeletons";
import { Workspace } from "@/app/lane/workspace/workspace";
import { WorkspaceProvider } from "@/app/lane/workspace/workspace-provider";

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
 * Mutations arrive by two channels, and both end here. Creating something calls
 * a Server Action, whose response *is* this route rendered again — the new task
 * comes back already in its sorted place. Editing a task calls the API from the
 * browser and lands the answer in the lane directly, marking only the counters
 * it could not compute; the rerender that follows is a background one, and it
 * republishes every region just the same. Neither channel needs the other to
 * know what it did (see `api/hooks.ts`).
 *
 * `/lane-spa` is the same workspace with the opposite answer: no seeding,
 * client loaders, and the cache maintenance that comes with owning your data.
 */
export default function Page({ searchParams }: PageProps) {
  return (
    <WorkspaceProvider session={getSession()}>
      <Workspace
        sidebar={
          <Suspense
            fallback={<SidebarSkeleton brand={<WorkspaceBrand />} />}
          >
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
        detail={
          <Suspense fallback={<DetailPanelSkeleton />}>
            <TaskDetailRegion searchParams={searchParams} />
          </Suspense>
        }
      />
    </WorkspaceProvider>
  );
}
