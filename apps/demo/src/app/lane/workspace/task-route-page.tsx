import { Suspense } from "react";
import { TaskDetailRegion } from "@/app/lane/regions";
import { DetailPanelSkeleton } from "@/app/lane/workspace/skeletons";
import { TaskDetailBoundary } from "@/app/lane/workspace/task-detail-panel";

export type TaskRouteProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The task-only publication used by every intercepted panel route. */
export function TaskPanelRoute({ params, searchParams }: TaskRouteProps) {
  return (
    <TaskDetailBoundary>
      <Suspense fallback={<DetailPanelSkeleton />}>
        <TaskDetailRegion params={params} searchParams={searchParams} />
      </Suspense>
    </TaskDetailBoundary>
  );
}
