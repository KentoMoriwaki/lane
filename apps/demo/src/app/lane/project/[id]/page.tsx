import { Suspense } from "react";
import {
  FilterBarRegion,
  ProjectHeaderRegion,
  SidebarRegion,
  TaskListRegion,
} from "@/app/lane/regions";
import { WorkspaceBrand } from "@/app/lane/workspace/brand";
import {
  FilterBarSkeleton,
  ProjectHeaderSkeleton,
  SidebarSkeleton,
  TaskListSkeleton,
} from "@/app/lane/workspace/skeletons";
import { Workspace } from "@/app/lane/workspace/workspace";

export const instant = true;

type ProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** A project is a fixed list context, not a shortcut that rewrites filters. */
export default function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const regionProps = { projectParams: params, searchParams };

  return (
    <Workspace
      sidebar={
        <Suspense fallback={<SidebarSkeleton brand={<WorkspaceBrand />} />}>
          <SidebarRegion searchParams={searchParams} />
        </Suspense>
      }
      contextHeader={
        <Suspense fallback={<ProjectHeaderSkeleton />}>
          <ProjectHeaderRegion {...regionProps} />
        </Suspense>
      }
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
