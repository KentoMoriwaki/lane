"use client";

import { Check, ChevronDown, ListFilter, RotateCw, X } from "lucide-react";
import * as React from "react";
import { graphql, useFragment } from "react-relay";
import {
  EMPTY_FILTERS,
  type TaskFilters,
} from "@/app/relay/api/filters";
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
import type { filterBar_query$key } from "@/app/relay/__generated__/filterBar_query.graphql";

const filterBarFragment = graphql`
  fragment filterBar_query on Query {
    projects {
      id
      name
      color
    }
    labels {
      id
      name
      color
    }
  }
`;

export function FilterBar({
  query,
  filters,
  taskCount,
  isPending,
  onFilterChange,
  onResetFilters,
}: {
  query: filterBar_query$key;
  filters: TaskFilters;
  taskCount: number;
  isPending: boolean;
  onFilterChange: (filters: TaskFilters) => void;
  onResetFilters: () => void;
}) {
  const { projects, labels } = useFragment(filterBarFragment, query);
  const [optimisticFilters, applyOptimistic] = React.useOptimistic(
    filters,
    (current, patch: Partial<TaskFilters>) => ({ ...current, ...patch }),
  );

  const applyPatch = React.useCallback(
    (patch: Partial<TaskFilters>) => {
      React.startTransition(() => {
        applyOptimistic(patch);
        onFilterChange({ ...optimisticFilters, ...patch });
      });
    },
    [applyOptimistic, onFilterChange, optimisticFilters],
  );

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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <div className="inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        {(["all", "mine", "unassigned"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => applyPatch({ scope })}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              optimisticFilters.scope === scope &&
                "bg-surface text-foreground shadow-sm",
            )}
          >
            {scope === "all"
              ? "All"
              : scope === "mine"
                ? "My tasks"
                : "Unassigned"}
          </button>
        ))}
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
          return (
            <FilterOption
              key={status}
              checked={optimisticFilters.status.includes(status)}
              icon={<Icon className={cn("size-4", accent(meta.accent).text)} />}
              label={meta.label}
              onToggle={() =>
                applyPatch({
                  status: toggleValue(optimisticFilters.status, status),
                })
              }
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
          return (
            <FilterOption
              key={priority}
              checked={optimisticFilters.priority.includes(priority)}
              icon={<Icon className={cn("size-4", accent(meta.accent).text)} />}
              label={meta.label}
              onToggle={() =>
                applyPatch({
                  priority: toggleValue(optimisticFilters.priority, priority),
                })
              }
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
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => {
            React.startTransition(() => {
              applyOptimistic(EMPTY_FILTERS);
              onResetFilters();
            });
          }}
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
          {taskCount} {taskCount === 1 ? "task" : "tasks"}
        </span>
      </div>
    </div>
  );
}

export function FilterBarSkeleton() {
  return <div className="h-[49px] border-b border-border" />;
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function FilterOption({
  checked,
  icon,
  label,
  onToggle,
}: {
  checked: boolean;
  icon: React.ReactNode;
  label: string;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
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
