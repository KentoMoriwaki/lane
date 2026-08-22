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
import { useWorkspaceUrl } from "./use-workspace-url";

export function TaskList() {
  const { filters, selectedTaskId, selectTask, resetFilters } =
    useWorkspaceUrl();
  const activeFilters = hasActiveFilters(filters);
  const onSelectTask = selectTask;
  const onResetFilters = resetFilters;
  const onClearSelection = React.useCallback(
    (taskId: string) => {
      if (selectedTaskId === taskId) selectTask(null);
    },
    [selectedTaskId, selectTask],
  );
  const { id: userId } = useSessionUser();
  const { refresh, isRefreshing, error } = useWorkspaceRefresh();
  const { promise, isInvalidationPending } = useTasks(filters);
  const { data: tasks } = React.use(promise);

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

  if (tasks.length === 0) {
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
    items: tasks.filter((task) => task.priority === priority),
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
            onSelectTask={onSelectTask}
            onClearSelection={onClearSelection}
          />
        ))}
      </div>
    </>
  );
}

function PriorityGroup({
  label,
  items,
  currentUserId,
  selectedTaskId,
  onSelectTask,
  onClearSelection,
}: {
  label: string;
  items: Task[];
  currentUserId: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onClearSelection: (taskId: string) => void;
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
          <TaskRow
            key={`${task.id}:${task.updatedAt}`}
            task={task}
            isMine={task.assignee?.id === currentUserId}
            isSelected={task.id === selectedTaskId}
            onSelect={() => onSelectTask(task.id)}
            deleteAction={onClearSelection}
          />
        ))}
      </div>
    </section>
  );
}
