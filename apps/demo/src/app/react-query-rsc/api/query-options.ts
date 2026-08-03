import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceCtx } from "./client";
import {
  type TaskFilters,
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasksByIds,
  fetchTasks,
  fetchTeams,
} from "./endpoints";

/**
 * Query keys.
 *
 * Team-owned keys deliberately omit `teamId` — the active team is treated as
 * the single workspace and travels via request headers. When the team changes,
 * the workspace provider removes these keys from the cache (see
 * `workspace-provider.tsx`). Session-level keys are kept separate.
 */
export const queryKeys = {
  currentUser: ["current-user"] as const,
  teams: ["teams"] as const,
  tasks: (filters: TaskFilters) => ["tasks", filters] as const,
  task: (taskId: string) => ["task", taskId] as const,
  taskBlockedBy: (taskId: string) => ["task-blocked-by", taskId] as const,
  taskBlocking: (taskId: string) => ["task-blocking", taskId] as const,
  projects: ["projects"] as const,
  labels: ["labels"] as const,
  members: ["members"] as const,
  insights: ["insights"] as const,
};

/** Keys that belong to the active team and must be cleared when it changes. */
export const TEAM_SCOPED_KEYS = [
  ["tasks"],
  ["task"],
  ["task-blocked-by"],
  ["task-blocking"],
  ["projects"],
  ["labels"],
  ["members"],
  ["insights"],
] as const;

export function currentUserQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.currentUser,
    queryFn: () => fetchCurrentUser(ctx),
  });
}

export function teamsQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.teams,
    queryFn: () => fetchTeams(ctx),
  });
}

/**
 * The board's own reads — the task list and the two views derived from it —
 * revalidate when the tab comes back to the foreground.
 *
 * They are the reads a teammate's edit invalidates, so coming back to a stale
 * board is the case worth handling; the catalogue reads around them keep the
 * client default of refetching only on demand. `staleTime` is short enough that a
 * refocus after a moment away actually fetches, and long enough that flicking
 * between two windows does not.
 *
 * This remains the client-owned half of the hybrid: Server Actions converge
 * through RSC hydration, while focus revalidation and URL states that were not
 * part of the latest server generation can still execute browser queryFns.
 */
const BOARD_REVALIDATION = {
  refetchOnWindowFocus: true,
  staleTime: 1_000,
} as const;

export function tasksQueryOptions(ctx: WorkspaceCtx, filters: TaskFilters) {
  return queryOptions({
    queryKey: queryKeys.tasks(filters),
    queryFn: () => fetchTasks(ctx, filters),
    ...BOARD_REVALIDATION,
  });
}

export function taskQueryOptions(ctx: WorkspaceCtx, taskId: string) {
  return queryOptions({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(ctx, taskId),
  });
}

export function blockedByTasksQueryOptions(
  ctx: WorkspaceCtx,
  taskId: string,
  ids: string[],
) {
  return queryOptions({
    queryKey: queryKeys.taskBlockedBy(taskId),
    queryFn: () => fetchTasksByIds(ctx, ids),
    staleTime: 5_000,
  });
}

export function blockingTasksQueryOptions(
  ctx: WorkspaceCtx,
  taskId: string,
  ids: string[],
) {
  return queryOptions({
    queryKey: queryKeys.taskBlocking(taskId),
    queryFn: () => fetchTasksByIds(ctx, ids),
    staleTime: 5_000,
  });
}

export function projectsQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.projects,
    queryFn: () => fetchProjects(ctx),
    // Carries per-project task counts, so it moves whenever the board does.
    ...BOARD_REVALIDATION,
  });
}

export function labelsQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.labels,
    queryFn: () => fetchLabels(ctx),
  });
}

export function membersQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.members,
    queryFn: () => fetchMembers(ctx),
  });
}

export function insightsQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.insights,
    queryFn: () => fetchInsights(ctx),
    ...BOARD_REVALIDATION,
  });
}
