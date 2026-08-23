"use client";

import type { Task } from "@/server/api";
import { MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { useDeleteTask, useUpdateTask } from "@/app/lane/api/hooks";
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

/**
 * A row is a link to the task's own route.
 *
 * Clicking it is a soft navigation to `/lane/task/<id>`, intercepted into the
 * `@modal` slot so the detail opens beside this list and the list itself is
 * never re-rendered by the navigation. The href carries the current filters and
 * team along, which is what keeps the list reading the very key it was
 * published under while the panel is on top of it.
 *
 * The controls inside the row — the status icon, the actions menu — are not
 * navigations. They both stop the event and cancel it: stopping it alone would
 * leave the anchor's own activation to run and take the browser to the task.
 *
 * The accessible name is the title alone, set explicitly. Left to the row's
 * contents it would begin with the status control's label ("Status: In
 * progress …"), which reads badly and makes every row answer to the same
 * queries the insight cards do.
 */
export function TaskRow({
  task,
  isSelected,
  isMine,
  dimmed,
  href,
  deleteAction,
}: {
  task: Task;
  isSelected: boolean;
  isMine: boolean;
  dimmed?: boolean;
  href: string;
  deleteAction?: (taskId: string) => void;
}) {
  // The list is on screen beside whatever this opens, so an edit made from a
  // row patches the row in place rather than marking the list stale.
  const update = useUpdateTask(task.id, "panel");
  const remove = useDeleteTask("panel");
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
      // The row's identity, in the DOM: what the list's order policy decided,
      // readable without matching on a title that an edit can change.
      data-task-id={task.id}
      className={cn(
        "group relative flex items-center gap-3 border-l-2 border-transparent py-2.5 pl-3 pr-2 text-sm transition-colors",
        "hover:bg-accent/60 focus-within:bg-accent/60",
        isSelected && "bg-accent border-l-cobalt",
        isMine && !isSelected && "border-l-cobalt/40",
        dimmed && "opacity-60",
        isClosed && "text-muted-foreground",
      )}
    >
      {/* The way into the task, laid *behind* the row rather than wrapped
          around it. A link that contains the controls makes every one of them
          responsible for cancelling a navigation it never asked for — and a
          control that only stops propagation (a popover trigger) still leaves
          the browser following the anchor it sits in. Positioned, so it covers
          the row and paints beneath the controls below, which carry `relative`
          to sit on top: interactive content is never nested in the link. */}
      <Link
        href={href}
        scroll={false}
        aria-label={optimisticTask.title}
        aria-current={isSelected ? "page" : undefined}
        // Going where you already are is not a navigation, and here it is a
        // destructive one: this href is the panel's own URL, so a click on the
        // open row navigates *from* the task route rather than from the list,
        // which is not the referrer the interception matches — the router
        // renders the task without the list behind it. Nothing to do instead:
        // the panel is already open on this task.
        onClick={isSelected ? (event) => event.preventDefault() : undefined}
        className="absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />

      <PriorityIcon
        priority={optimisticTask.priority}
        className="relative shrink-0"
      />

      <div className="relative">
        <StatusControl
          variant="icon"
          value={optimisticTask.status}
          changeAction={(status) => {
            startUpdateTransition(async () => {
              addOptimisticTask({ type: "status", status });
              try {
                await update({ status });
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

      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1">
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

      <div className="relative opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 data-[open=true]:opacity-100">
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

