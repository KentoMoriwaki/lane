import { Suspense } from "react";
import {
  FilterBarRegion,
  SidebarRegion,
  TaskListRegion,
} from "@/app/lane/regions";
import { WorkspaceBrand } from "@/app/lane/workspace/brand";
import {
  FilterBarSkeleton,
  SidebarSkeleton,
  TaskListSkeleton,
} from "@/app/lane/workspace/skeletons";
import type { WorkspaceContextKey } from "@/app/lane/workspace/workspace-context";
import { Workspace } from "@/app/lane/workspace/workspace";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

/** The shared static shell for each named, mutually exclusive task Context. */
export function TaskContextPage({
  contextKey,
  searchParams,
}: {
  contextKey: Exclude<WorkspaceContextKey, "project">;
  searchParams: SearchParams;
}) {
  const regionProps = { contextKey, searchParams };

  return (
    <Workspace
      sidebar={
        <Suspense fallback={<SidebarSkeleton brand={<WorkspaceBrand />} />}>
          <SidebarRegion {...regionProps} />
        </Suspense>
      }
      contextHeader={null}
      filterBar={
        <Suspense fallback={<FilterBarSkeleton />}>
          <FilterBarRegion {...regionProps} />
        </Suspense>
      }
      taskList={
        <Suspense fallback={<TaskListSkeleton />}>
          <TaskListRegion {...regionProps} />
        </Suspense>
      }
    />
  );
}
