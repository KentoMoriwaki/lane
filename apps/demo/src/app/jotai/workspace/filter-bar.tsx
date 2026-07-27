"use client";

import { Check, ChevronDown, ListFilter, RotateCw, X } from "lucide-react";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/jotai/api/endpoints";
import { useLabels, useProjects, useTasks } from "@/app/jotai/api/hooks";
import { useWorkspaceTransition } from "@/app/jotai/api/workspace-transition";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onFilterChange,
  onResetFilters,
}: {
  filters: TaskFilters;
  onFilterChange: (filters: TaskFilters) => void;
  onResetFilters: () => void;
}) {
  // The controls answer immediately while the list behind them is still
  // loading: `useOptimistic` owns the chips, the atom owns the data.
  const [optimisticFilters, addOptimisticFilterPatch] = React.useOptimistic(
    filters,
    (current, patch: Partial<TaskFilters>) => ({ ...current, ...patch }),
  );
  const projects = useProjects();
  const labels = useLabels();
  const tasks = useTasks();
  const { isPending } = useWorkspaceTransition();

  const project = projects.find(
    (item) => item.id === optimisticFilters.projectId,
  );
  const label = labels.find((item) => item.id === optimisticFilters.labelId);
  const dueLabel =
    optimisticFilters.due === "overdue"
      ? "Overdue"
      : optimisticFilters.due === "week"
        ? "Due this week"
        : optimisticFilters.due === "today"
          ? "Due today"
          : null;

  const hasActiveFilters =
    optimisticFilters.scope !== "all" ||
    optimisticFilters.status.length > 0 ||
    optimisticFilters.priority.length > 0 ||
    Boolean(optimisticFilters.projectId) ||
    Boolean(optimisticFilters.labelId) ||
    Boolean(optimisticFilters.due) ||
    optimisticFilters.q.trim().length > 0;

  const applyPatch = React.useCallback(
    (patch: Partial<TaskFilters>) => {
      const nextFilters = { ...optimisticFilters, ...patch };
      React.startTransition(() => {
        addOptimisticFilterPatch(patch);
      });
      onFilterChange(nextFilters);
    },
    [addOptimisticFilterPatch, onFilterChange, optimisticFilters],
  );

  const clearFilters = React.useCallback(() => {
    React.startTransition(() => {
      addOptimisticFilterPatch(EMPTY_FILTERS);
    });
    onResetFilters();
  }, [addOptimisticFilterPatch, onResetFilters]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <div className="inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        <ScopeButton
          isActive={optimisticFilters.scope === "all"}
          onSelect={() => applyPatch({ scope: "all" })}
        >
          All
        </ScopeButton>
        <ScopeButton
          isActive={optimisticFilters.scope === "mine"}
          onSelect={() => applyPatch({ scope: "mine" })}
        >
          My tasks
        </ScopeButton>
        <ScopeButton
          isActive={optimisticFilters.scope === "unassigned"}
          onSelect={() => applyPatch({ scope: "unassigned" })}
        >
          Unassigned
        </ScopeButton>
      </div>

      <FilterDropdown
        label="Status"
        count={optimisticFilters.status.length}
        icon={<ListFilter className="size-3.5" />}
      >
        <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_META[status];
          const Icon = meta.icon;
          const nextStatus = toggleValue(optimisticFilters.status, status);
          return (
            <FilterOption
              key={status}
              checked={optimisticFilters.status.includes(status)}
              icon={<Icon className={cn("size-4", accent(meta.accent).text)} />}
              label={meta.label}
              onSelect={() => applyPatch({ status: nextStatus })}
            />
          );
        })}
      </FilterDropdown>

      <FilterDropdown label="Priority" count={optimisticFilters.priority.length}>
        <DropdownMenuLabel>Filter by priority</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PRIORITY_ORDER.map((priority) => {
          const meta = PRIORITY_META[priority];
          const Icon = meta.icon;
          const nextPriority = toggleValue(
            optimisticFilters.priority,
            priority,
          );
          return (
            <FilterOption
              key={priority}
              checked={optimisticFilters.priority.includes(priority)}
              icon={<Icon className={cn("size-4", accent(meta.accent).text)} />}
              label={meta.label}
              onSelect={() => applyPatch({ priority: nextPriority })}
            />
          );
        })}
      </FilterDropdown>

      {project ? (
        <Chip
          dotClass={accent(project.color).dot}
          label={project.name}
          onRemove={() => applyPatch({ projectId: null })}
        />
      ) : null}
      {label ? (
        <Chip
          dotClass={accent(label.color).dot}
          label={label.name}
          onRemove={() => applyPatch({ labelId: null })}
        />
      ) : null}
      {dueLabel ? (
        <Chip label={dueLabel} onRemove={() => applyPatch({ due: null })} />
      ) : null}

      {hasActiveFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={clearFilters}
        >
          Clear
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {isPending ? (
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

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function ScopeButton({
  isActive,
  onSelect,
  children,
}: {
  isActive: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="rounded-md" onClick={onSelect}>
      <span
        className={cn(
          "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          isActive ? "bg-surface text-foreground shadow-sm" : undefined,
        )}
      >
        {children}
      </span>
    </button>
  );
}

function FilterOption({
  checked,
  icon,
  label,
  onSelect,
}: {
  checked: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
      className="gap-2.5"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <Check className="size-4 text-cobalt" /> : null}
      </span>
      {icon}
      <span className={cn(checked && "font-medium text-foreground")}>
        {label}
      </span>
    </DropdownMenuItem>
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
