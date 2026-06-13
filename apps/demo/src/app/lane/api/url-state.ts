import type { TaskPriority, TaskScope, TaskStatus } from "@/server/api";
import { EMPTY_FILTERS, type TaskFilters } from "./endpoints";

/**
 * The URL is the source of truth for durable workspace view state: active team,
 * filters, search, and the selected task. This module is the single, framework
 * free place that parses and serializes that state, so the Server Component
 * (from `searchParams`) and the client (from `useSearchParams`) always agree —
 * which keeps Lane keys identical across RSC seeding and client reads.
 */

const STATUS_VALUES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
];
const PRIORITY_VALUES: TaskPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];
const SCOPE_VALUES: TaskScope[] = ["all", "mine", "unassigned"];
const DUE_VALUES: NonNullable<TaskFilters["due"]>[] = [
  "overdue",
  "today",
  "week",
];

export type WorkspaceUrlState = {
  /** `null` when no `team` param is present (the user's default team applies). */
  teamId: string | null;
  filters: TaskFilters;
  selectedTaskId: string | null;
};

/** A reader over a query string (URLSearchParams.get or a server param getter). */
export type ParamGetter = (key: string) => string | null;

export function parseWorkspaceState(get: ParamGetter): WorkspaceUrlState {
  const scope = get("scope");
  const due = get("due");

  return {
    teamId: nonEmpty(get("team")),
    selectedTaskId: nonEmpty(get("task")),
    filters: {
      scope: includesValue(SCOPE_VALUES, scope) ? scope : "all",
      q: get("q")?.trim() ?? "",
      status: parseList(get("status"), STATUS_VALUES),
      priority: parseList(get("priority"), PRIORITY_VALUES),
      projectId: nonEmpty(get("project")),
      labelId: nonEmpty(get("label")),
      due: includesValue(DUE_VALUES, due) ? due : null,
    },
  };
}

export function buildWorkspaceSearch(state: WorkspaceUrlState): string {
  const params = new URLSearchParams();
  const { filters } = state;

  if (state.teamId) params.set("team", state.teamId);
  if (filters.scope !== "all") params.set("scope", filters.scope);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status.length) params.set("status", filters.status.join(","));
  if (filters.priority.length)
    params.set("priority", filters.priority.join(","));
  if (filters.projectId) params.set("project", filters.projectId);
  if (filters.labelId) params.set("label", filters.labelId);
  if (filters.due) params.set("due", filters.due);
  if (state.selectedTaskId) params.set("task", state.selectedTaskId);

  return params.toString();
}

export function buildWorkspaceHref(
  pathname: string,
  state: WorkspaceUrlState,
  next: Partial<WorkspaceUrlState>,
): string {
  const merged = { ...state, ...next };
  const search = buildWorkspaceSearch(merged);
  return search ? `${pathname}?${search}` : pathname;
}

/** Convenience for the Server Component, whose `searchParams` is a record. */
export function getterFromRecord(
  record: Record<string, string | string[] | undefined> | undefined,
): ParamGetter {
  return (key) => {
    const value = record?.[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };
}

export const EMPTY_VIEW_STATE: WorkspaceUrlState = {
  teamId: null,
  filters: EMPTY_FILTERS,
  selectedTaskId: null,
};

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function includesValue<T extends string>(
  allowed: readonly T[],
  value: string | null,
): value is T {
  return value !== null && (allowed as readonly string[]).includes(value);
}

function parseList<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T[] {
  if (!value) return [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (
      trimmed &&
      !seen.has(trimmed) &&
      (allowed as readonly string[]).includes(trimmed)
    ) {
      seen.add(trimmed);
      result.push(trimmed as T);
    }
  }
  return result;
}
