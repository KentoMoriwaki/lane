import { Suspense } from "react";
import {
  FilterBarRegion,
  ProjectHeaderRegion,
  SidebarDataRegion,
  TaskListRegion,
} from "@/app/lane/regions";
import {
  FilterBarSkeleton,
  ProjectHeaderSkeleton,
  TaskListSkeleton,
} from "@/app/lane/workspace/skeletons";
import { WorkspaceContent } from "@/app/lane/workspace/workspace";

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
    <>
      <Suspense fallback={null}>
        <SidebarDataRegion searchParams={searchParams} />
      </Suspense>

      <WorkspaceContent
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
    </>
  );
}
