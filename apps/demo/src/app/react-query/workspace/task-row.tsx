"use client";

import type { Task } from "@/server/api";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDeleteTask, useUpdateTask } from "@/app/react-query/api/hooks";
import { taskCacheStrategies } from "@/app/react-query/api/task-cache-sync";
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
  const isClosed = STATUS_META[task.status].group === "closed";

  function handleDelete() {
    remove.mutate(task, {
      onSuccess: () => {
        toast.success("Task deleted");
        deleteAction?.(task.id);
      },
      onError: (error) =>
        toast.error("Couldn't delete task", {
          description: error instanceof Error ? error.message : undefined,
        }),
    });
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
      <PriorityIcon priority={task.priority} className="shrink-0" />

      <div onClick={(event) => event.stopPropagation()}>
        <StatusControl
          variant="icon"
          value={task.status}
          changeAction={(status) =>
            update.mutate(
              { input: { status }, strategy: taskCacheStrategies.status },
              {
                onError: (error) =>
                  toast.error("Couldn't update status", {
                    description:
                      error instanceof Error ? error.message : undefined,
                  }),
              },
            )
          }
          pending={update.isPending}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            "truncate font-medium text-foreground",
            isClosed && "text-muted-foreground line-through decoration-1",
          )}
        >
          {task.title}
        </span>
        {task.labels.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {task.labels.slice(0, 3).map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
            {task.labels.length > 3 ? (
              <span className="text-[11px] text-muted-foreground">
                +{task.labels.length - 3}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {task.project ? (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground md:inline-flex">
          <span
            className={cn(
              "size-1.5 rounded-full",
              accent(task.project.color).dot,
            )}
          />
          {task.project.key}
        </span>
      ) : null}

      <div className="hidden w-16 shrink-0 justify-end sm:flex">
        <DueBadge dueDate={task.dueDate} isClosed={isClosed} withIcon={false} />
      </div>

      {task.assignee ? (
        <Avatar
          size="sm"
          initials={task.assignee.initials}
          color={task.assignee.color}
          title={task.assignee.name}
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
