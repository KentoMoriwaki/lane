"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Group,
  RotateCw,
} from "lucide-react";
import * as React from "react";
import { useTasks } from "@/app/lane/api/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  type TaskGroupBy,
  type TaskSortBy,
  useTaskView,
} from "./use-task-view";
import { useWorkspaceUrl } from "./use-workspace-url";

const GROUP_OPTIONS: Array<{ value: TaskGroupBy; label: string }> = [
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
  { value: "assignee", label: "Assignee" },
  { value: "none", label: "None" },
];

const SORT_OPTIONS: Array<{ value: TaskSortBy; label: string }> = [
  { value: "default", label: "Default" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "title", label: "Title" },
];

/** Presentation controls only: neither control changes the task read key. */
export function FilterBar() {
  const { filters, fixedProjectId } = useWorkspaceUrl();
  const tasksResult = useTasks(filters);
  const list = React.use(tasksResult.promise).data;
  const loaded = list.pages.reduce((count, page) => count + page.items.length, 0);
  const { group, sort, order, updateView } = useTaskView();
  const groups = fixedProjectId
    ? GROUP_OPTIONS.filter((option) => option.value !== "project")
    : GROUP_OPTIONS;

  return (
    <div
      data-testid="view-toolbar"
      className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2"
    >
      <ViewMenu
        icon={<Group className="size-3.5" />}
        label="Group"
        valueLabel={labelFor(GROUP_OPTIONS, group)}
        options={groups}
        value={group}
        selectAction={(value) => updateView({ group: value as TaskGroupBy })}
      />
      <ViewMenu
        icon={<ArrowUpDown className="size-3.5" />}
        label="Sort"
        valueLabel={labelFor(SORT_OPTIONS, sort)}
        options={SORT_OPTIONS}
        value={sort}
        selectAction={(value) => updateView({ sort: value as TaskSortBy })}
      />
      {sort !== "default" ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={order === "asc" ? "Sort descending" : "Sort ascending"}
          onClick={() => updateView({ order: order === "asc" ? "desc" : "asc" })}
        >
          {order === "asc" ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )}
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {tasksResult.isInvalidationPending ? (
          <span className="inline-flex items-center gap-1 text-cobalt">
            <RotateCw className="size-3 animate-spin" />
            Updating
          </span>
        ) : tasksResult.isBackgroundPending ? (
          <span className="inline-flex items-center gap-1">
            <RotateCw className="size-3 animate-spin" />
            Syncing
          </span>
        ) : null}
        <span className="tabular-nums" data-testid="task-count">
          {loaded} {loaded === 1 ? "task" : "tasks"}
          {list.hasNext ? " so far" : ""}
        </span>
      </div>
    </div>
  );
}

function labelFor<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function ViewMenu<T extends string>({
  icon,
  label,
  valueLabel,
  options,
  value,
  selectAction,
}: {
  icon: React.ReactNode;
  label: string;
  valueLabel: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  selectAction: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {icon}
          <span className="text-muted-foreground">{label}:</span>
          {valueLabel}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>{label} tasks by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="gap-2.5"
            onSelect={() => selectAction(option.value)}
          >
            <span className="flex size-4 items-center justify-center">
              {option.value === value ? (
                <Check className="size-4 text-cobalt" />
              ) : null}
            </span>
            <span
              className={cn(
                option.value === value && "font-medium text-foreground",
              )}
            >
              {option.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
