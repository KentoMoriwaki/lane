"use client";

import type { Task } from "@/server/api";
import { Inbox, ListTodo, Loader2 } from "lucide-react";
import * as React from "react";
import { useTasks } from "@/app/lane/api/hooks";
import type { TaskFilters } from "@/app/lane/api/endpoints";
import { Button } from "@/components/ui/button";
import {
  PRIORITY_GROUP_ORDER,
  PRIORITY_META,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/task-meta";
import { useSessionUser, useWorkspaceRefresh } from "./workspace-provider";
import { EmptyState, ErrorChip } from "./feedback";
import { TaskRow } from "./task-row";
import {
  type TaskGroupBy,
  type TaskSortBy,
  type TaskSortOrder,
  useTaskView,
} from "./use-task-view";
import { useSelectedTaskId, useWorkspaceUrl } from "./use-workspace-url";

/**
 * The list, and what a row now is: a `<Link>` to `/lane/tasks/<id>`.
 *
 * Opening a task is a navigation rather than a state change. Clicked from here
 * it is intercepted into the `@modal` slot and drawn as the panel beside this
 * list, which is why this component neither renders the detail nor knows that
 * it exists — it only says which task each row points at, and reads the current
 * pathname to know which of them is the open one.
 *
 * **The first page is the route's; the depth is the browser's.** `useTasks` is
 * an infinite read on one key per Context: the active route publishes page 1,
 * `loadMore` fetches the next page for the complete filters, and both live in
   * one value. Search omits `q` from the key so the next page publication can
   * update the current reader without resetting the whole view. This component
   * flattens those pages and offers the button while `hasNext`.
 *
 * The stable display policy runs over that flattened list first. Grouping and
 * sorting are a browser-owned projection on top: they never change the Lane
 * key or ask the route for another task set.
 */
export function TaskList() {
  const {
    contextKey,
    filters,
    taskHref,
    rememberTaskNavigation,
    closeDeletedTask,
    clearSearch,
  } = useWorkspaceUrl();
  const selectedTaskId = useSelectedTaskId();
  const hasSearch = filters.q.trim().length > 0;
  const { group, sort, order } = useTaskView();
  const onDeleted = React.useCallback(
    (taskId: string) => {
      // Only the row that is currently open takes the view with it.
      if (selectedTaskId === taskId) closeDeletedTask();
    },
    [closeDeletedTask, selectedTaskId],
  );
  const { id: userId } = useSessionUser();
  const { refresh, isRefreshing, error } = useWorkspaceRefresh();
  const { promise, isInvalidationPending, loadMore } = useTasks(filters);
  const { data, error: readError } = React.use(promise);
  // The pages, as one list. The first belongs to the route and the rest to the
  // browser; from here down there is no difference between them, which is the
  // point of them sharing a key.
  const tasks = React.useMemo(
    () => data.pages.flatMap((page) => page.items),
    [data.pages],
  );
  const displayed = useDisplayOrder(filters, tasks);
  const arranged = React.useMemo(
    () => sortTasks(displayed, sort, order),
    [displayed, order, sort],
  );
  const groups = React.useMemo(
    () => groupTasks(arranged, group),
    [arranged, group],
  );

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
        {hasSearch ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks match this search"
            message="Try another phrase or clear the search to see this Context again."
            action={
              <button
                type="button"
                onClick={clearSearch}
                className="text-sm font-medium text-cobalt hover:underline"
              >
                Clear search
              </button>
            }
          />
        ) : contextKey !== "all" ? (
          <EmptyState
            icon={Inbox}
            title="No tasks in this Context"
            message="This view has no matching tasks yet."
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

  return (
    <>
      {refreshNotice}
      <div
        className="divide-y divide-border transition-opacity"
        style={{ opacity: dimmed ? 0.6 : 1 }}
      >
        {groups.map((taskGroup) => (
          <TaskGroup
            key={taskGroup.key}
            groupKey={taskGroup.key}
            label={taskGroup.label}
            showHeader={group !== "none"}
            items={taskGroup.items}
            currentUserId={userId}
            selectedTaskId={selectedTaskId}
            taskHref={taskHref}
            rememberTaskNavigation={rememberTaskNavigation}
            onDeleted={onDeleted}
          />
        ))}
      </div>
      {data.hasNext ? (
        <div className="flex justify-center border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="load-more"
            disabled={isInvalidationPending}
            onClick={() => {
              void loadMore();
            }}
          >
            {isInvalidationPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Loading
              </>
            ) : readError ? (
              "Try again"
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      ) : null}
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
 * Grouping is not part of what is remembered. A row is always drawn under the
 * heading named by its current value, whether the user groups by priority,
 * status, project, or assignee. Explicit sorting is also allowed to move rows;
 * the stable order remains the baseline restored by `Sort: Default`.
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

type DisplayGroup = {
  key: string;
  label: string;
  items: Task[];
};

function groupTasks(tasks: Task[], group: TaskGroupBy): DisplayGroup[] {
  if (group === "none") {
    return [{ key: "all", label: "All tasks", items: tasks }];
  }

  if (group === "priority") {
    return PRIORITY_GROUP_ORDER.map((priority) => ({
      key: priority,
      label: PRIORITY_META[priority].label,
      items: tasks.filter((task) => task.priority === priority),
    })).filter((entry) => entry.items.length > 0);
  }

  if (group === "status") {
    return STATUS_ORDER.map((status) => ({
      key: status,
      label: STATUS_META[status].label,
      items: tasks.filter((task) => task.status === status),
    })).filter((entry) => entry.items.length > 0);
  }

  const entries = new Map<string, DisplayGroup>();
  for (const task of tasks) {
    const item =
      group === "project"
        ? task.project
          ? { key: task.project.id, label: task.project.name }
          : { key: "unassigned", label: "No project" }
        : task.assignee
          ? { key: task.assignee.id, label: task.assignee.name }
          : { key: "unassigned", label: "Unassigned" };
    const entry = entries.get(item.key) ?? { ...item, items: [] };
    entry.items.push(task);
    entries.set(item.key, entry);
  }

  return [...entries.values()].sort((left, right) => {
    if (left.key === "unassigned") return 1;
    if (right.key === "unassigned") return -1;
    return left.label.localeCompare(right.label);
  });
}

function sortTasks(
  tasks: Task[],
  sort: TaskSortBy,
  order: TaskSortOrder,
): Task[] {
  if (sort === "default") return tasks;

  const direction = order === "asc" ? 1 : -1;
  return [...tasks].sort((left, right) => {
    let compared = 0;
    switch (sort) {
      case "due":
        if (!left.dueDate && !right.dueDate) compared = 0;
        else if (!left.dueDate) return 1;
        else if (!right.dueDate) return -1;
        else compared = left.dueDate.localeCompare(right.dueDate);
        break;
      case "priority":
        compared =
          PRIORITY_GROUP_ORDER.indexOf(left.priority) -
          PRIORITY_GROUP_ORDER.indexOf(right.priority);
        break;
      case "updated":
        compared = left.updatedAt.localeCompare(right.updatedAt);
        break;
      case "created":
        compared = left.createdAt.localeCompare(right.createdAt);
        break;
      case "title":
        compared = left.title.localeCompare(right.title);
        break;
    }
    return compared === 0
      ? left.id.localeCompare(right.id)
      : compared * direction;
  });
}

function TaskGroup({
  groupKey,
  label,
  showHeader,
  items,
  currentUserId,
  selectedTaskId,
  taskHref,
  rememberTaskNavigation,
  onDeleted,
}: {
  groupKey: string;
  label: string;
  showHeader: boolean;
  items: Task[];
  currentUserId: string;
  selectedTaskId: string | null;
  taskHref: (taskId: string) => string;
  rememberTaskNavigation: (href: string) => void;
  onDeleted: (taskId: string) => void;
}) {
  return (
    <section data-testid="task-group" data-group-key={groupKey}>
      {showHeader ? (
        <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/85 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
          {label}
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
            {items.length}
          </span>
        </header>
      ) : null}
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
            navigateAction={rememberTaskNavigation}
            deleteAction={onDeleted}
          />
        ))}
      </div>
    </section>
  );
}
