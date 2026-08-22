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
 * Mutations do not change shape: a Server Action mutates and calls `refresh()`,
 * this route renders again, and every region republishes. One coherent
 * workspace, delivered in pieces.
 *
 * The discipline that buys it: the client never writes to these keys. Where the
 * round trip is too slow to feel right, `useOptimistic` covers it over the read
 * value, which is a display concern and never a write.
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
