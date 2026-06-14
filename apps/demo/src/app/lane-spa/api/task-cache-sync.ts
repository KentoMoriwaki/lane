import type { Task } from "@/server/api";
import type { LaneEntryInfo } from "use-lane";
import type { TaskFilters } from "./endpoints";

export type TaskCacheStrategy = {
  refreshInsights: boolean;
  refreshProjects: boolean;
  shouldInvalidateTaskList: (filters: TaskFilters) => boolean;
};

const stableList: TaskCacheStrategy = {
  refreshInsights: false,
  refreshProjects: false,
  shouldInvalidateTaskList: () => false,
};

export const taskCacheStrategies = {
  assignee: {
    refreshInsights: true,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => filters.scope !== "all",
  },
  dueDate: {
    refreshInsights: true,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => Boolean(filters.due),
  },
  labels: {
    refreshInsights: false,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) =>
      Boolean(filters.labelId) || filters.q.trim().length > 0,
  },
  priority: {
    refreshInsights: false,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => filters.priority.length > 0,
  },
  project: {
    refreshInsights: false,
    refreshProjects: true,
    shouldInvalidateTaskList: (filters) => Boolean(filters.projectId),
  },
  searchText: {
    refreshInsights: false,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => filters.q.trim().length > 0,
  },
  stableList,
  status: {
    refreshInsights: true,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) =>
      filters.status.length > 0 || Boolean(filters.due),
  },
} satisfies Record<string, TaskCacheStrategy>;

export function replaceTaskInList(tasks: Task[], task: Task): Task[] {
  return tasks.map((item) => (item.id === task.id ? task : item));
}

export function taskFiltersFromEntry(entry: LaneEntryInfo): TaskFilters | null {
  const [source, filters] = entry.key;

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
