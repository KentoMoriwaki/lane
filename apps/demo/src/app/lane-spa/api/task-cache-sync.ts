import type { Task } from "@/server/api";
import type { LaneEntryInfo } from "use-lane";
import type { TaskFilters } from "./endpoints";

export type TaskCacheStrategy = {
  refreshDependencies: boolean;
  refreshInsights: boolean;
  refreshProjects: boolean;
  shouldInvalidateTaskList: (filters: TaskFilters) => boolean;
};

const stableList: TaskCacheStrategy = {
  refreshDependencies: false,
  refreshInsights: false,
  refreshProjects: false,
  shouldInvalidateTaskList: () => false,
};

export const taskCacheStrategies = {
  assignee: {
    refreshDependencies: false,
    refreshInsights: true,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => filters.scope !== "all",
  },
  dueDate: {
    refreshDependencies: false,
    refreshInsights: true,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => Boolean(filters.due),
  },
  labels: {
    refreshDependencies: false,
    refreshInsights: false,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) =>
      Boolean(filters.labelId) || filters.q.trim().length > 0,
  },
  priority: {
    refreshDependencies: false,
    refreshInsights: false,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => filters.priority.length > 0,
  },
  project: {
    refreshDependencies: false,
    refreshInsights: false,
    refreshProjects: true,
    shouldInvalidateTaskList: (filters) => Boolean(filters.projectId),
  },
  searchText: {
    refreshDependencies: true,
    refreshInsights: false,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) => filters.q.trim().length > 0,
  },
  stableList,
  status: {
    refreshDependencies: true,
    refreshInsights: true,
    refreshProjects: false,
    shouldInvalidateTaskList: (filters) =>
      filters.status.length > 0 || Boolean(filters.due),
  },
} satisfies Record<string, TaskCacheStrategy>;

export function replaceTaskInList(tasks: Task[], task: Task): Task[] {
  return tasks.map((item) => (item.id === task.id ? task : item));
}

export function insertTaskIntoMatchingList(
  tasks: Task[],
  task: Task,
  filters: TaskFilters,
  currentUserId: string,
): Task[] {
  if (!taskMatchesFilters(task, filters, currentUserId)) {
    return tasks;
  }

  return [...tasks.filter((item) => item.id !== task.id), task].sort(
    compareTasks,
  );
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

const statusOrder: Record<Task["status"], number> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  canceled: 5,
};

const priorityOrder: Record<Task["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function taskMatchesFilters(
  task: Task,
  filters: TaskFilters,
  currentUserId: string,
): boolean {
  if (filters.status.length > 0 && !filters.status.includes(task.status)) {
    return false;
  }
  if (
    filters.priority.length > 0 &&
    !filters.priority.includes(task.priority)
  ) {
    return false;
  }
  if (filters.projectId && task.project?.id !== filters.projectId) {
    return false;
  }
  if (
    filters.labelId &&
    !task.labels.some((label) => label.id === filters.labelId)
  ) {
    return false;
  }
  if (filters.scope === "mine" && task.assignee?.id !== currentUserId) {
    return false;
  }
  if (filters.scope === "unassigned" && task.assignee !== null) {
    return false;
  }
  if (filters.due && !matchesDueFilter(task, filters.due)) {
    return false;
  }

  const query = filters.q.trim().toLowerCase();
  return (
    query.length === 0 ||
    task.title.toLowerCase().includes(query) ||
    task.description.toLowerCase().includes(query) ||
    task.labels.some((label) => label.name.toLowerCase().includes(query))
  );
}

function matchesDueFilter(task: Task, dueFilter: NonNullable<TaskFilters["due"]>) {
  if (!task.dueDate) {
    return false;
  }

  const due = new Date(task.dueDate).getTime();
  const now = Date.now();
  if (dueFilter === "overdue") {
    return due < now && !isClosed(task);
  }
  if (dueFilter === "today") {
    return new Date(due).toDateString() === new Date(now).toDateString();
  }
  return due >= now && due <= now + 7 * 86_400_000;
}

function compareTasks(a: Task, b: Task): number {
  const closedDiff = Number(isClosed(a)) - Number(isClosed(b));
  if (closedDiff !== 0) return closedDiff;

  const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
  if (priorityDiff !== 0) return priorityDiff;

  const statusDiff = statusOrder[a.status] - statusOrder[b.status];
  if (statusDiff !== 0) return statusDiff;

  return a.createdAt < b.createdAt ? -1 : 1;
}

function isClosed(task: Task): boolean {
  return task.status === "done" || task.status === "canceled";
}
