"use client";

import type { TaskPriority, TaskScope, TaskStatus } from "@lane/todo-api";
import { ChevronDown, ListFilter, RotateCw, X } from "lucide-react";
import * as React from "react";
import type { TaskFilters } from "@/api/endpoints";
import { useLabels, useProjects, useTasks } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { accent } from "@/lib/accent";
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/task-meta";
import { cn } from "@/lib/utils";

export function FilterBar({
  filters,
  onScopeChange,
  onToggleStatus,
  onTogglePriority,
  onPatch,
  onResetAll,
}: {
  filters: TaskFilters;
  onScopeChange: (scope: TaskScope) => void;
  onToggleStatus: (status: TaskStatus) => void;
  onTogglePriority: (priority: TaskPriority) => void;
  onPatch: (patch: Partial<TaskFilters>) => void;
  onResetAll: () => void;
}) {
  const projectsResult = useProjects();
  const labelsResult = useLabels();
  const tasksResult = useTasks(filters);
  const projects = React.use(projectsResult.promise);
  const labels = React.use(labelsResult.promise);
  const tasks = React.use(tasksResult.promise);

  const project = projects?.find((item) => item.id === filters.projectId);
  const label = labels?.find((item) => item.id === filters.labelId);
  const dueLabel =
    filters.due === "overdue"
      ? "Overdue"
      : filters.due === "week"
        ? "Due this week"
        : filters.due === "today"
          ? "Due today"
          : null;

  const hasActiveFilters =
    filters.scope !== "all" ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    Boolean(filters.projectId) ||
    Boolean(filters.labelId) ||
    Boolean(filters.due) ||
    filters.q.trim().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <Tabs
        value={filters.scope}
        onValueChange={(value) => onScopeChange(value as TaskScope)}
      >
        <TabsList className="h-8">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="mine">My tasks</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterDropdown
        label="Status"
        count={filters.status.length}
        icon={<ListFilter className="size-3.5" />}
      >
        <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_META[status];
          const Icon = meta.icon;
          return (
            <DropdownMenuCheckboxItem
              key={status}
              checked={filters.status.includes(status)}
              onSelect={(event) => {
                event.preventDefault();
                onToggleStatus(status);
              }}
            >
              <Icon className={cn("size-4", accent(meta.accent).text)} />
              {meta.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </FilterDropdown>

      <FilterDropdown label="Priority" count={filters.priority.length}>
        <DropdownMenuLabel>Filter by priority</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PRIORITY_ORDER.map((priority) => {
          const meta = PRIORITY_META[priority];
          const Icon = meta.icon;
          return (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={filters.priority.includes(priority)}
              onSelect={(event) => {
                event.preventDefault();
                onTogglePriority(priority);
              }}
            >
              <Icon className={cn("size-4", accent(meta.accent).text)} />
              {meta.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </FilterDropdown>

      {project ? (
        <Chip
          dotClass={accent(project.color).dot}
          label={project.name}
          onRemove={() => onPatch({ projectId: null })}
        />
      ) : null}
      {label ? (
        <Chip
          dotClass={accent(label.color).dot}
          label={label.name}
          onRemove={() => onPatch({ labelId: null })}
        />
      ) : null}
      {dueLabel ? (
        <Chip label={dueLabel} onRemove={() => onPatch({ due: null })} />
      ) : null}

      {hasActiveFilters ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={onResetAll}
          className="text-muted-foreground"
        >
          Clear
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {tasksResult.isPending ? (
          <span className="inline-flex items-center gap-1 text-cobalt">
            <RotateCw className="size-3 animate-spin" />
            Updating
          </span>
        ) : null}
        <span className="tabular-nums">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
    </div>
  );
}

function FilterDropdown({
  label,
  count,
  icon,
  children,
}: {
  label: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(count > 0 && "border-cobalt/40 text-cobalt")}
        >
          {icon}
          {label}
          {count > 0 ? (
            <span className="rounded-full bg-cobalt/15 px-1.5 text-[11px] font-semibold">
              {count}
            </span>
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chip({
  dotClass,
  label,
  onRemove,
}: {
  dotClass?: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground">
      {dotClass ? (
        <span className={cn("size-2 rounded-full", dotClass)} />
      ) : null}
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground hover:text-rose"
        aria-label={`Remove ${label} filter`}
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
