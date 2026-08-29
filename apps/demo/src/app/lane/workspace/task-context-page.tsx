import { Suspense } from "react";
import {
  ProjectHeaderRegion,
  SidebarDataRegion,
  TaskListRegion,
} from "@/app/lane/regions";
import { FilterBar } from "@/app/lane/workspace/filter-bar";
import {
  FilterBarSkeleton,
  ProjectHeaderSkeleton,
  TaskListSkeleton,
} from "@/app/lane/workspace/skeletons";
import { TaskList } from "@/app/lane/workspace/task-list";
import { TaskRouteBootstrap } from "@/app/lane/workspace/task-route-bootstrap";
import { WorkspaceContent } from "@/app/lane/workspace/workspace";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

/** The visible page and request-bound data for one task Context. */
export function TaskContextPage({
  contextParams,
  projectParams,
  searchParams,
}: {
  contextParams?: Promise<{ context: string }>;
  projectParams?: Promise<{ projectId: string }>;
  searchParams: SearchParams;
}) {
  const regionProps = {
    contextParams,
    projectParams,
    searchParams,
  };

  return (
    <>
      {/* Only the Sidebar reader lives outside this page, because its layout is
          deliberately persistent across Context navigations. */}
      <Suspense fallback={null}>
        <SidebarDataRegion searchParams={searchParams} />
      </Suspense>

      {/* The page owns both the list publication and its visible readers. A
          direct task visit establishes this page first; the subsequent
          intercepted navigation leaves it mounted and adds only the panel. */}
      <Suspense
        fallback={
          <WorkspaceContent
            contextHeader={projectParams ? <ProjectHeaderSkeleton /> : null}
            filterBar={<FilterBarSkeleton />}
            taskList={<TaskListSkeleton />}
          />
        }
      >
        <TaskListRegion {...regionProps}>
          <>
            <WorkspaceContent
              contextHeader={
                projectParams ? (
                  <Suspense fallback={<ProjectHeaderSkeleton />}>
                    <ProjectHeaderRegion projectParams={projectParams} />
                  </Suspense>
                ) : null
              }
              filterBar={<FilterBar />}
              taskList={<TaskList />}
            />
            {/* Do not change the URL until this publication and its readers
                have hydrated; otherwise selected-row state can differ between
                the server list and its first client render. */}
            <Suspense fallback={null}>
              <TaskRouteBootstrap />
            </Suspense>
          </>
        </TaskListRegion>
      </Suspense>
    </>
  );
}
