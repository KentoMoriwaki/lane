"use client";

import type { Task } from "@/server/api";
import { Inbox, ListTodo } from "lucide-react";
import * as React from "react";
import { useTasks } from "@/app/lane/api/hooks";
import type { TaskFilters } from "@/app/lane/api/endpoints";
import { PRIORITY_GROUP_ORDER, PRIORITY_META } from "@/lib/task-meta";
import { useSessionUser, useWorkspaceRefresh } from "./workspace-provider";
import { EmptyState, ErrorChip } from "./feedback";
import { TaskRow } from "./task-row";
import { hasActiveFilters } from "./use-workspace-hrefs";
import { useSelectedTaskId, useWorkspaceUrl } from "./use-workspace-url";

/**
 * The list, and what a row now is: a `<Link>` to `/lane/task/<id>`.
 *
 * Opening a task is a navigation rather than a state change. Clicked from here
 * it is intercepted into the `@modal` slot and drawn as the panel beside this
 * list, which is why this component neither renders the detail nor knows that
 * it exists — it only says which task each row points at, and reads the current
 * pathname to know which of them is the open one.
 */
export function TaskList() {
  const { filters, taskHref, closeTask, resetFilters } = useWorkspaceUrl();
  const selectedTaskId = useSelectedTaskId();
  const activeFilters = hasActiveFilters(filters);
  const onResetFilters = resetFilters;
  const onDeleted = React.useCallback(
    (taskId: string) => {
      // Only the row that is currently open takes the view with it.
      if (selectedTaskId === taskId) closeTask();
    },
    [closeTask, selectedTaskId],
  );
  const { id: userId } = useSessionUser();
  const { refresh, isRefreshing, error } = useWorkspaceRefresh();
  const { promise, isInvalidationPending } = useTasks(filters);
  const { data: tasks } = React.use(promise);
  const displayed = useDisplayOrder(filters, tasks);

  const dimmed = isInvalidationPending || isRefreshing;
  // The read cannot fail here — it is served by the publication — so what the
  // chip reports is the *refresh* that failed: the last one the user asked for
  // never reached the owner, and what is on screen is the publication before it.
  // Retrying means asking again, not re-fetching from here.
  const refreshNotice = (
    <ErrorChip
      error={error}
      onRetry={refresh}
      isRetrying={isRefreshing}
      className="mx-4 mt-3"
    />
  );

  if (displayed.length === 0) {
    return (
      <>
        {refreshNotice}
        {activeFilters ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks match these filters"
            message="Try widening your filters to see more of the team's work."
            action={
              <button
                type="button"
                onClick={onResetFilters}
                className="text-sm font-medium text-cobalt hover:underline"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No tasks yet"
            message="Create the first task to get the team moving."
          />
        )}
      </>
    );
  }

  const groups = PRIORITY_GROUP_ORDER.map((priority) => ({
    priority,
    items: displayed.filter((task) => task.priority === priority),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      {refreshNotice}
      <div
        className="divide-y divide-border transition-opacity"
        style={{ opacity: dimmed ? 0.6 : 1 }}
      >
        {groups.map((group) => (
          <PriorityGroup
            key={group.priority}
            label={PRIORITY_META[group.priority].label}
            items={group.items}
            currentUserId={userId}
            selectedTaskId={selectedTaskId}
            taskHref={taskHref}
            onDeleted={onDeleted}
          />
        ))}
      </div>
    </>
  );
}

/**
 * **The order on screen, which is not the order in the data.**
 *
 * The data is the server's sorted truth and stays that way: every publication
 * arrives sorted by closed-ness, priority, status, and age, and a background
 * rerender can re-sort the whole list while the user is halfway through editing
 * a row in it. Applying that sort directly is what makes a list jump — you
 * mark a task done and the row you were pointing at leaves for the bottom of
 * the screen, taking the next click with it.
 *
 * So this component keeps a *rendering* policy of its own: **the order is
 * stable for as long as the list is on screen.** It remembers the ids in the
 * order it drew them and re-uses that order for every value that follows. Rows
 * that persist keep their relative order however the server re-sorts them; rows
 * that are gone leave; rows that are new are inserted where the server's order
 * puts them among the rows already placed. It resets when the list itself
 * changes — different filters are a different list — and on remount, because a
 * fresh mount has nothing to be stable with respect to.
 *
 * The priority *group* is not part of what is remembered. A row is always drawn
 * under the heading its own priority names, because a row sitting under "Low"
 * with an urgent icon on it is a lie, and priority is the one field the list
 * itself does not edit — it changes in the detail panel, where the round trip
 * is covered optimistically and the row's own position is not what the user is
 * looking at. So: an edit never moves a row, except a priority change, which
 * moves it once, to the group it now belongs in.
 *
 * The insertion scan is quadratic in the worst case. A page of tasks is the
 * size it is on screen, and this runs once per publication.
 */
function useDisplayOrder(filters: TaskFilters, tasks: Task[]): Task[] {
  // The filters decide the list, and they decide the Lane key too — same
  // fields, same order, so serializing them here identifies the same list the
  // read does.
  const listKey = JSON.stringify(filters);
  const [remembered, setRemembered] = React.useState(() => ({
    listKey,
    published: tasks,
    ids: tasks.map((task) => task.id),
  }));

  const changed =
    remembered.listKey !== listKey || remembered.published !== tasks;
  const ids = !changed
    ? remembered.ids
    : remembered.listKey !== listKey
      ? tasks.map((task) => task.id)
      : mergeDisplayOrder(remembered.ids, tasks);

  // Deriving during render rather than in an effect: the order has to be
  // decided in the same pass that draws it, or the first frame of every
  // publication is drawn in the server's order and corrected afterwards, which
  // is the jump this exists to prevent.
  if (changed) {
    setRemembered({ listKey, published: tasks, ids });
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));

  return ids.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
}

function mergeDisplayOrder(shown: string[], tasks: Task[]): string[] {
  const arriving = tasks.map((task) => task.id);
  const present = new Set(arriving);
  const order = shown.filter((id) => present.has(id));
  const placed = new Set(order);

  for (const [index, id] of arriving.entries()) {
    if (placed.has(id)) {
      continue;
    }

    // Sit the newcomer directly behind the nearest task the server puts ahead
    // of it that is already on screen — the front of the list when there is
    // none, which is where a new task sorted to the top belongs.
    let at = 0;
    for (let ahead = index - 1; ahead >= 0; ahead--) {
      const anchor = order.indexOf(arriving[ahead]);
      if (anchor !== -1) {
        at = anchor + 1;
        break;
      }
    }

    order.splice(at, 0, id);
    placed.add(id);
  }

  return order;
}

function PriorityGroup({
  label,
  items,
  currentUserId,
  selectedTaskId,
  taskHref,
  onDeleted,
}: {
  label: string;
  items: Task[];
  currentUserId: string;
  selectedTaskId: string | null;
  taskHref: (taskId: string) => string;
  onDeleted: (taskId: string) => void;
}) {
  return (
    <section>
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/85 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
        {label}
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
          {items.length}
        </span>
      </header>
      <div className="divide-y divide-border/70 px-1">
        {items.map((task) => (
          // Keyed by id alone. The row used to be keyed by `id:updatedAt` so
          // that a republished task remounted with the new values — the row is
          // patched in place now, and remounting it would throw away the
          // `useOptimistic` cover and the open transition at the exact moment
          // the confirmed value lands, which is the flicker the optimistic
          // value exists to prevent.
          <TaskRow
            key={task.id}
            task={task}
            isMine={task.assignee?.id === currentUserId}
            isSelected={task.id === selectedTaskId}
            href={taskHref(task.id)}
            deleteAction={onDeleted}
          />
        ))}
      </div>
    </section>
  );
}
