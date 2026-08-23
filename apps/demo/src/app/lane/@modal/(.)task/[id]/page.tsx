import { Suspense } from "react";
import { TaskDetailRegion } from "@/app/lane/regions";
import { TaskDetailBoundary } from "@/app/lane/workspace/task-detail-panel";
import { DetailPanelSkeleton } from "@/app/lane/workspace/skeletons";

export const instant = true;

type InterceptedTaskProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * **The panel: `/lane/task/<id>` reached by a `<Link>` from the list.**
 *
 * `(.)` intercepts the navigation at the `/lane` level, so the `children` slot
 * keeps the list exactly as it was — same scroll, same rows, same lane entries
 * — and only this slot renders. `layout.tsx` draws it as the column on the
 * right, which is where the detail used to live as a `?task=` region of the
 * list route itself.
 *
 * It reads and publishes exactly what the full page does; `surface="panel"`
 * only says the list is on screen beside it, which is what lets an edit here
 * patch the row in place instead of marking the list stale.
 *
 * **Traverse is not interception.** Browser back and forward *into* this URL
 * re-suspend: the RSC payload varies on `Next-Url`, so the router has no cached
 * copy of the intercepted form to restore (measured in `apps/activity-lab`;
 * it is Next's behavior, not Lane's). The demo's route in is the `<Link>`.
 */
export default function InterceptedTaskPanel({
  params,
  searchParams,
}: InterceptedTaskProps) {
  return (
    <TaskDetailBoundary surface="panel">
      <Suspense fallback={<DetailPanelSkeleton />}>
        <TaskDetailRegion
          params={params}
          searchParams={searchParams}
          surface="panel"
        />
      </Suspense>
    </TaskDetailBoundary>
  );
}
