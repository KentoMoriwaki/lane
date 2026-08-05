"use client";

import { Check, ChevronDown, ListFilter, RotateCw, X } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane-spa/api/endpoints";
import { useLabels, useProjects, useTasks } from "@/app/lane-spa/api/hooks";
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
  filterHref,
  resetHref,
  onFilterChange,
  onResetFilters,
}: {
  filters: TaskFilters;
  filterHref?: (filters: TaskFilters) => string | undefined;
  resetHref?: string;
  onFilterChange?: (filters: TaskFilters) => void;
  onResetFilters?: () => void;
}) {
  const [optimisticFilters, addOptimisticFilterPatch] = React.useOptimistic(
    filters,
    (current, patch: Partial<TaskFilters>) => ({ ...current, ...patch }),
  );
  const projectsResult = useProjects();
  const labelsResult = useLabels();
  const tasksResult = useTasks(filters);
  const projects = React.use(projectsResult.promise).data;
  const labels = React.use(labelsResult.promise).data;
  const tasks = React.use(tasksResult.promise).data;

  const project = projects?.find(
    (item) => item.id === optimisticFilters.projectId,
  );
  const label = labels?.find((item) => item.id === optimisticFilters.labelId);
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

  const hrefForPatch = React.useCallback(
    (patch: Partial<TaskFilters>) =>
      filterHref?.({ ...optimisticFilters, ...patch }),
    [filterHref, optimisticFilters],
  );

  const applyPatch = React.useCallback(
    (patch: Partial<TaskFilters>) => {
      const nextFilters = { ...optimisticFilters, ...patch };
      React.startTransition(() => {
        addOptimisticFilterPatch(patch);
      });
      onFilterChange?.(nextFilters);
    },
    [addOptimisticFilterPatch, onFilterChange, optimisticFilters],
  );

  const clearFilters = React.useCallback(() => {
    React.startTransition(() => {
      addOptimisticFilterPatch(EMPTY_FILTERS);
    });
    onResetFilters?.();
  }, [addOptimisticFilterPatch, onResetFilters]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <div className="inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        <ScopeLink
          href={hrefForPatch({ scope: "all" })}
          isActive={optimisticFilters.scope === "all"}
          navigateAction={() => applyPatch({ scope: "all" })}
        >
          All
        </ScopeLink>
        <ScopeLink
          href={hrefForPatch({ scope: "mine" })}
          isActive={optimisticFilters.scope === "mine"}
          navigateAction={() => applyPatch({ scope: "mine" })}
        >
          My tasks
        </ScopeLink>
        <ScopeLink
          href={hrefForPatch({ scope: "unassigned" })}
          isActive={optimisticFilters.scope === "unassigned"}
          navigateAction={() => applyPatch({ scope: "unassigned" })}
        >
          Unassigned
        </ScopeLink>
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
            <FilterOptionLink
              key={status}
              checked={optimisticFilters.status.includes(status)}
              href={hrefForPatch({ status: nextStatus })}
              icon={<Icon className={cn("size-4", accent(meta.accent).text)} />}
              label={meta.label}
              navigateAction={() => applyPatch({ status: nextStatus })}
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
            <FilterOptionLink
              key={priority}
              checked={optimisticFilters.priority.includes(priority)}
              href={hrefForPatch({ priority: nextPriority })}
              icon={<Icon className={cn("size-4", accent(meta.accent).text)} />}
              label={meta.label}
              navigateAction={() => applyPatch({ priority: nextPriority })}
            />
          );
        })}
      </FilterDropdown>

      {project ? (
        <Chip
          dotClass={accent(project.color).dot}
          label={project.name}
          removeHref={hrefForPatch({ projectId: null })}
          navigateAction={() => applyPatch({ projectId: null })}
        />
      ) : null}
      {label ? (
        <Chip
          dotClass={accent(label.color).dot}
          label={label.name}
          removeHref={hrefForPatch({ labelId: null })}
          navigateAction={() => applyPatch({ labelId: null })}
        />
      ) : null}
      {dueLabel ? (
        <Chip
          label={dueLabel}
          removeHref={hrefForPatch({ due: null })}
          navigateAction={() => applyPatch({ due: null })}
        />
      ) : null}

      {hasActiveFilters && resetHref ? (
        <Button
          asChild
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
        >
          <Link
            href={resetHref}
            prefetch={false}
            scroll={false}
            onClick={clearFilters}
          >
            <ClearLinkLabel />
          </Link>
        </Button>
      ) : hasActiveFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={clearFilters}
        >
          <ClearLabel />
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {tasksResult.isInvalidationPending ? (
          <span className="inline-flex items-center gap-1 text-cobalt">
            <RotateCw className="size-3 animate-spin" />
            Updating
          </span>
        ) : tasksResult.isBackgroundPending ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <RotateCw className="size-3 animate-spin" />
            Syncing
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

function ScopeLink({
  href,
  isActive,
  navigateAction,
  children,
}: {
  href?: string;
  isActive: boolean;
  navigateAction: () => void;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <button type="button" className="rounded-md" onClick={navigateAction}>
        <ScopeLinkContent isActive={isActive}>{children}</ScopeLinkContent>
      </button>
    );
  }

  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      className="rounded-md"
      onClick={navigateAction}
    >
      <ScopeLinkStatusContent isActive={isActive}>
        {children}
      </ScopeLinkStatusContent>
    </Link>
  );
}

function ScopeLinkStatusContent({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <ScopeLinkContent isActive={isActive || pending}>
      {children}
    </ScopeLinkContent>
  );
}

function ScopeLinkContent({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        isActive ? "bg-surface text-foreground shadow-sm" : undefined,
      )}
    >
      {children}
    </span>
  );
}

function ClearLinkLabel() {
  const { pending } = useLinkStatus();

  return <span className={cn(pending && "text-foreground")}>Clear</span>;
}

function ClearLabel() {
  return <span>Clear</span>;
}

function FilterOptionLink({
  href,
  checked,
  icon,
  label,
  navigateAction,
}: {
  href?: string;
  checked: boolean;
  icon: React.ReactNode;
  label: string;
  navigateAction: () => void;
}) {
  if (!href) {
    return (
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          navigateAction();
        }}
        className="gap-2.5"
      >
        <FilterOptionContent checked={checked} icon={icon} label={label} />
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      asChild
      onSelect={(event) => event.preventDefault()}
      className="gap-2.5"
    >
      <Link href={href} prefetch={false} scroll={false} onClick={navigateAction}>
        <FilterOptionContent checked={checked} icon={icon} label={label} />
      </Link>
    </DropdownMenuItem>
  );
}

function FilterOptionContent({
  checked,
  icon,
  label,
}: {
  checked: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <Check className="size-4 text-cobalt" /> : null}
      </span>
      {icon}
      <span className={cn(checked && "font-medium text-foreground")}>
        {label}
      </span>
    </>
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
  removeHref,
  navigateAction,
}: {
  dotClass?: string;
  label: string;
  removeHref?: string;
  navigateAction: () => void;
}) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground">
      {dotClass ? (
        <span className={cn("size-2 rounded-full", dotClass)} />
      ) : null}
      {label}
      {removeHref ? (
        <Link
          href={removeHref}
          prefetch={false}
          scroll={false}
          onClick={navigateAction}
          className="rounded-full p-0.5 text-muted-foreground hover:text-rose"
          aria-label={`Remove ${label} filter`}
        >
          <ChipRemoveLinkIcon />
        </Link>
      ) : (
        <button
          type="button"
          onClick={navigateAction}
          className="rounded-full p-0.5 text-muted-foreground hover:text-rose"
          aria-label={`Remove ${label} filter`}
        >
          <ChipRemoveIcon />
        </button>
      )}
    </span>
  );
}

function ChipRemoveLinkIcon() {
  const { pending } = useLinkStatus();

  return (
    <X className={cn("size-3.5", pending ? "text-rose" : undefined)} />
  );
}

function ChipRemoveIcon() {
  return <X className="size-3.5" />;
}
