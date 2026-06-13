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
  projects: ["projects"] as const,
  labels: ["labels"] as const,
  members: ["members"] as const,
  insights: ["insights"] as const,
};

/** Keys that belong to the active team and must be cleared when it changes. */
export const TEAM_SCOPED_KEYS = [
  ["tasks"],
  ["task"],
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

export function tasksQueryOptions(ctx: WorkspaceCtx, filters: TaskFilters) {
  return queryOptions({
    queryKey: queryKeys.tasks(filters),
    queryFn: () => fetchTasks(ctx, filters),
  });
}

export function taskQueryOptions(ctx: WorkspaceCtx, taskId: string) {
  return queryOptions({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(ctx, taskId),
  });
}

export function projectsQueryOptions(ctx: WorkspaceCtx) {
  return queryOptions({
    queryKey: queryKeys.projects,
    queryFn: () => fetchProjects(ctx),
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
  });
}
