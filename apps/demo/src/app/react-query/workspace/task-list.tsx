"use client";

import type { Task } from "@/server/api";
import { Inbox, ListTodo } from "lucide-react";
import { useTasks } from "@/app/react-query/api/hooks";
import type { TaskFilters } from "@/app/react-query/api/endpoints";
import { Skeleton } from "@/components/ui/skeleton";
import { PRIORITY_GROUP_ORDER, PRIORITY_META } from "@/lib/task-meta";
import { useWorkspace } from "./workspace-provider";
import { EmptyState, SectionError } from "./feedback";
import { TaskRow } from "./task-row";

export function TaskList({
  filters,
  hasActiveFilters,
  selectedTaskId,
  onSelectTask,
  onClearSelection,
  onResetFilters,
}: {
  filters: TaskFilters;
  hasActiveFilters: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onClearSelection: (taskId: string) => void;
  onResetFilters: () => void;
}) {
  const { userId } = useWorkspace();

  // `filters.q` is already debounced upstream of the URL by the search field,
  // so the filters that reach here are settled values — no second debounce.
  const {
    data: tasks,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
    isPlaceholderData,
  } = useTasks(filters);

  // Background refresh / filter change while previous data is on screen.
  const dimmed = isFetching && isPlaceholderData;

  if (isPending) {
    return <TaskListSkeleton />;
  }

  if (isError) {
    return (
      <div className="p-4">
        <SectionError
          title="Couldn't load tasks"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (tasks.length === 0) {
    return hasActiveFilters ? (
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
    );
  }

  const groups = PRIORITY_GROUP_ORDER.map((priority) => ({
    priority,
    items: tasks.filter((task) => task.priority === priority),
  })).filter((group) => group.items.length > 0);

  return (
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
            onDeleted={onClearSelection}
          />
        ))}
      </div>
    </section>
  );
}

function TaskListSkeleton() {
  return (
    <div className="px-4 py-3">
      <Skeleton className="mb-3 h-3 w-24" />
      <div className="space-y-3">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 flex-1" style={{ maxWidth: `${60 - index * 4}%` }} />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="size-6 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
