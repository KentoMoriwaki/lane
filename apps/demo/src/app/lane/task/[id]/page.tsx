import { Suspense } from "react";
import { TaskDetailRegion } from "@/app/lane/regions";
import { TaskDetailBoundary } from "@/app/lane/workspace/task-detail-panel";
import { DetailPageSkeleton } from "@/app/lane/workspace/skeletons";

// Same claim the list makes: nothing is awaited above the boundary below, so a
// navigation into this route paints its shell immediately. `params` is a
// promise and it is resolved inside the region, not here.
export const instant = true;

type TaskPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * **A task, on its own.** The URL `/lane/task/<id>` is a real page: opened
 * directly, reloaded, or shared, this is what renders — the whole detail with a
 * link back to the list, and no workspace frame around it.
 *
 * The *same* URL reached by clicking a row is intercepted into
 * `@modal/(.)task/[id]` and drawn as the panel beside the list instead. One
 * URL, one read, one `useTask(id)`; two shells.
 *
 * `searchParams` travels with the link (filters, team) so the page reads the
 * task from the same team the list was showing, and the back link can restore
 * the view the user left.
 *
 * What an edit here does to the lane is the other half of the difference. The
 * list is not on screen, so there is nothing to patch in place: the confirmed
 * task is `set`, and every list entry this lane holds is marked stale rather
 * than rewritten (`api/hooks.ts`). Nothing is asked for until a list is
 * actually looked at again.
 */
export default function TaskPage({ params, searchParams }: TaskPageProps) {
  return (
    <TaskDetailBoundary surface="page">
      <Suspense fallback={<DetailPageSkeleton />}>
        <TaskDetailRegion
          params={params}
          searchParams={searchParams}
          surface="page"
        />
      </Suspense>
    </TaskDetailBoundary>
  );
}
