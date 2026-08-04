"use client";

import type { Task } from "@/server/api";
import { Inbox, ListTodo, MoreHorizontal, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { deleteTaskAction, updateTaskAction } from "@/app/lane/api/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, RefreshErrorChip } from "@/app/lane/workspace/feedback";
import {
  DueBadge,
  LabelChip,
  PriorityIcon,
} from "@/app/lane/workspace/task-bits";
import { StatusControl } from "@/app/lane/workspace/status-control";
import { accent } from "@/lib/accent";
import {
  PRIORITY_GROUP_ORDER,
  PRIORITY_META,
  STATUS_META,
} from "@/lib/task-meta";
import { cn } from "@/lib/utils";
import type { WorkspaceContext } from "./workspace";

export function TaskList({
  ctx,
  tasks,
  currentUserId,
  selectedTaskId,
  hasActiveFilters,
  refreshError,
  isRefreshing,
  isViewPending,
  onRefresh,
  onSelectTask,
  onClearSelection,
  onResetFilters,
}: {
  ctx: WorkspaceContext;
  tasks: Task[];
  currentUserId: string;
  selectedTaskId: string | null;
  hasActiveFilters: boolean;
  refreshError: unknown;
  isRefreshing: boolean;
  isViewPending: boolean;
  onRefresh: () => void;
  onSelectTask: (taskId: string) => void;
  onClearSelection: (taskId: string) => void;
  onResetFilters: () => void;
}) {
  const refreshNotice = (
    <RefreshErrorChip
      refreshError={refreshError}
      onRetry={onRefresh}
      isRetrying={isRefreshing}
      className="mx-4 mt-3"
    />
  );

  if (tasks.length === 0) {
    return (
      <>
        {refreshNotice}
        {hasActiveFilters ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks match these filters"
            message="Try widening your filters to see more of the team's work."
            action={
              <Button
                variant="link"
                onClick={onResetFilters}
                className="text-cobalt"
              >
                Clear filters
              </Button>
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
        style={{ opacity: isViewPending || isRefreshing ? 0.6 : 1 }}
      >
        {groups.map((group) => (
          <section key={group.priority}>
            <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/85 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              {PRIORITY_META[group.priority].label}
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                {group.items.length}
              </span>
            </header>
            <div className="divide-y divide-border/70 px-1">
              {group.items.map((task) => (
                <TaskRow
                  key={`${task.id}:${task.updatedAt}`}
                  ctx={ctx}
                  task={task}
                  isMine={task.assignee?.id === currentUserId}
                  isSelected={task.id === selectedTaskId}
                  onSelect={() => onSelectTask(task.id)}
                  deleteAction={onClearSelection}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function TaskRow({
  ctx,
  task,
  isSelected,
  isMine,
  onSelect,
  deleteAction,
}: {
  ctx: WorkspaceContext;
  task: Task;
  isSelected: boolean;
  isMine: boolean;
  onSelect: () => void;
  deleteAction: (taskId: string) => void;
}) {
  const [isUpdating, startUpdateTransition] = React.useTransition();
  const [isDeleting, startDeleteTransition] = React.useTransition();
  const [deleteConfirmed, setDeleteConfirmed] = React.useState(false);
  const [optimisticTask, addOptimisticTask] = React.useOptimistic<
    Task | null,
    { type: "status"; status: Task["status"] } | { type: "delete" }
  >(task, (current, change) => {
    if (change.type === "delete" || current === null) return null;
    return { ...current, status: change.status };
  });

  function handleDelete() {
    startDeleteTransition(async () => {
      addOptimisticTask({ type: "delete" });
      try {
        await deleteTaskAction(ctx, task.id);
        setDeleteConfirmed(true);
        toast.success("Task deleted");
        deleteAction(task.id);
      } catch (error) {
        toast.error("Couldn't delete task", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  if (deleteConfirmed || !optimisticTask) return null;
  const isClosed = STATUS_META[optimisticTask.status].group === "closed";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex items-center gap-3 border-l-2 border-transparent py-2.5 pl-3 pr-2 text-sm outline-none transition-colors",
        "hover:bg-accent/60 focus-visible:bg-accent/60",
        isSelected && "bg-accent border-l-cobalt",
        isMine && !isSelected && "border-l-cobalt/40",
        isClosed && "text-muted-foreground",
      )}
    >
      <PriorityIcon priority={optimisticTask.priority} className="shrink-0" />
      <div onClick={(event) => event.stopPropagation()}>
        <StatusControl
          variant="icon"
          value={optimisticTask.status}
          changeAction={(status) => {
            startUpdateTransition(async () => {
              addOptimisticTask({ type: "status", status });
              try {
                await updateTaskAction(ctx, task.id, { status });
              } catch (error) {
                toast.error("Couldn't update status", {
                  description:
                    error instanceof Error ? error.message : undefined,
                });
              }
            });
          }}
          pending={isUpdating || isDeleting}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            "truncate font-medium text-foreground",
            isClosed && "text-muted-foreground line-through decoration-1",
          )}
        >
          {optimisticTask.title}
        </span>
        {optimisticTask.labels.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {optimisticTask.labels.slice(0, 3).map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
            {optimisticTask.labels.length > 3 ? (
              <span className="text-[11px] text-muted-foreground">
                +{optimisticTask.labels.length - 3}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {optimisticTask.project ? (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground md:inline-flex">
          <span
            className={cn(
              "size-1.5 rounded-full",
              accent(optimisticTask.project.color).dot,
            )}
          />
          {optimisticTask.project.key}
        </span>
      ) : null}
      <div className="hidden w-16 shrink-0 justify-end sm:flex">
        <DueBadge
          dueDate={optimisticTask.dueDate}
          isClosed={isClosed}
          withIcon={false}
        />
      </div>
      {optimisticTask.assignee ? (
        <Avatar
          size="sm"
          initials={optimisticTask.assignee.initials}
          color={optimisticTask.assignee.color}
          title={optimisticTask.assignee.name}
        />
      ) : (
        <span
          className="size-6 shrink-0 rounded-full border border-dashed border-border"
          title="Unassigned"
        />
      )}
      <div
        onClick={(event) => event.stopPropagation()}
        className="opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label="Task actions"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-rose focus:bg-rose/10 focus:text-rose [&_svg]:text-rose"
            >
              <Trash2 className="size-4" /> Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
