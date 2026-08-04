"use client";

import type { Task } from "@/server/api";
import { MoreHorizontal, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useDeleteTask, useUpdateTask } from "@/app/lane-spa/api/hooks";
import { taskCacheStrategies } from "@/app/lane-spa/api/task-cache-sync";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { accent } from "@/lib/accent";
import { STATUS_META } from "@/lib/task-meta";
import { cn } from "@/lib/utils";
import { DueBadge, LabelChip, PriorityIcon } from "./task-bits";
import { StatusControl } from "./status-control";

export function TaskRow({
  task,
  isSelected,
  isMine,
  dimmed,
  onSelect,
  deleteAction,
}: {
  task: Task;
  isSelected: boolean;
  isMine: boolean;
  dimmed?: boolean;
  onSelect: () => void;
  deleteAction?: (taskId: string) => void;
}) {
  const update = useUpdateTask(task.id);
  const remove = useDeleteTask();
  const [isUpdating, startUpdateTransition] = React.useTransition();
  const [isDeleting, startDeleteTransition] = React.useTransition();
  const [deleteConfirmed, setDeleteConfirmed] = React.useState(false);
  const [optimisticTask, addOptimisticTask] = React.useOptimistic(
    task,
    (
      current,
      change:
        | { type: "status"; status: Task["status"] }
        | { type: "delete" },
    ): Task | null => {
      if (change.type === "delete" || current === null) {
        return null;
      }

      return { ...current, status: change.status };
    },
  );
  const isClosed = optimisticTask
    ? STATUS_META[optimisticTask.status].group === "closed"
    : false;

  function handleDelete() {
    startDeleteTransition(async () => {
      addOptimisticTask({ type: "delete" });
      try {
        await remove(task.id);
        setDeleteConfirmed(true);
        toast.success("Task deleted");
        deleteAction?.(task.id);
      } catch (error) {
        toast.error("Couldn't delete task", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
  }

  if (deleteConfirmed || !optimisticTask) {
    return null;
  }

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
        dimmed && "opacity-60",
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
                await update({ status }, taskCacheStrategies.status);
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
              <Trash2 className="size-4" />
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
