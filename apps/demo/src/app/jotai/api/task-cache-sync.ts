import type { Task } from "@/server/api";
import type { TaskFilters } from "./endpoints";

/**
 * After a write lands, every cached task list has to be reconciled. A list
 * whose membership cannot have changed only needs the row swapped in place; a
 * list the edit could add rows to or drop rows from has to be refetched. The
 * strategies below say which is which per edited field — the same table the
 * other variants use, so the implementations differ only in how they apply it,
 * not in what they decide.
 */
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

/**
 * The identity of a task-list read. `atomFamily` keeps one atom per distinct
 * param, so this is what decides whether two filter objects address the same
 * cached list — the jotai counterpart of a query key.
 */
export function taskFiltersKey(filters: TaskFilters): string {
  return JSON.stringify([
    filters.scope,
    filters.q.trim(),
    [...filters.status].sort(),
    [...filters.priority].sort(),
    filters.projectId,
    filters.labelId,
    filters.due,
  ]);
}
