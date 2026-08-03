import type { TaskFilters } from "./endpoints";

export type TaskCacheStrategy = {
  /** True when membership is uncertain and the list must await server hydration. */
  shouldInvalidateTaskList: (filters: TaskFilters) => boolean;
};

const stableList: TaskCacheStrategy = {
  shouldInvalidateTaskList: () => false,
};

export const taskCacheStrategies = {
  assignee: {
    shouldInvalidateTaskList: (filters) => filters.scope !== "all",
  },
  dueDate: {
    shouldInvalidateTaskList: (filters) => Boolean(filters.due),
  },
  labels: {
    shouldInvalidateTaskList: (filters) =>
      Boolean(filters.labelId) || filters.q.trim().length > 0,
  },
  priority: {
    shouldInvalidateTaskList: (filters) => filters.priority.length > 0,
  },
  project: {
    shouldInvalidateTaskList: (filters) => Boolean(filters.projectId),
  },
  searchText: {
    shouldInvalidateTaskList: (filters) => filters.q.trim().length > 0,
  },
  stableList,
  status: {
    shouldInvalidateTaskList: (filters) =>
      filters.status.length > 0 || Boolean(filters.due),
  },
} satisfies Record<string, TaskCacheStrategy>;

export function taskFiltersFromQueryKey(
  queryKey: readonly unknown[],
): TaskFilters | null {
  const [source, filters] = queryKey;

  if (source !== "tasks" || !isTaskFilters(filters)) {
    return null;
  }

  return filters;
}

function isTaskFilters(value: unknown): value is TaskFilters {
  if (!value || typeof value !== "object") {
    return false;
  }

  const filters = value as Partial<TaskFilters>;
  return (
    typeof filters.scope === "string" &&
    typeof filters.q === "string" &&
    Array.isArray(filters.status) &&
    Array.isArray(filters.priority) &&
    "projectId" in filters &&
    "labelId" in filters &&
    "due" in filters
  );
}
