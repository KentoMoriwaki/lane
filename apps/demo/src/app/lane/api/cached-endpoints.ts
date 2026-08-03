import { cacheLife, cacheTag } from "next/cache";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import {
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasks,
  fetchTeams,
  type TaskFilters,
} from "./endpoints";

/**
 * Next owns freshness for the server-owned demo; Lane owns publication into
 * the browser. These tags are deliberately coherence domains rather than a
 * mirror of every Lane key.
 *
 * Task lists, task details, project counts, and insights have different
 * dependencies. Keeping them separate lets a mutation expire only the reads it
 * can actually change while Lane still publishes one coherent workspace.
 */
export const workspaceCacheTags = {
  currentUser: () => "lane:current-user",
  teams: (userId: string) => `lane:teams:${userId}`,
  members: (teamId: string) => `lane:members:${teamId}`,
  labels: (teamId: string) => `lane:labels:${teamId}`,
  taskLists: (teamId: string) => `lane:task-lists:${teamId}`,
  taskDetails: (teamId: string) => `lane:task-details:${teamId}`,
  task: (teamId: string, taskId: string) =>
    `lane:task:${teamId}:${taskId}`,
  projects: (teamId: string) => `lane:projects:${teamId}`,
  insights: (teamId: string) => `lane:insights:${teamId}`,
};

export async function getCachedCurrentUser(userId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.currentUser());

  return fetchCurrentUser({ userId, teamId: "" });
}

export async function getCachedTeams(userId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.teams(userId));

  return fetchTeams({ userId, teamId: "" });
}

export async function getCachedMembers(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.members(ctx.teamId));

  return fetchMembers(ctx);
}

export async function getCachedLabels(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.labels(ctx.teamId));

  return fetchLabels(ctx);
}

export async function getCachedTasks(ctx: WorkspaceCtx, filters: TaskFilters) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.taskLists(ctx.teamId));

  return fetchTasks(ctx, filters);
}

export async function getCachedTask(ctx: WorkspaceCtx, taskId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(
    workspaceCacheTags.taskDetails(ctx.teamId),
    workspaceCacheTags.task(ctx.teamId, taskId),
  );

  return fetchTask(ctx, taskId);
}

export async function getCachedProjects(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.projects(ctx.teamId));

  return fetchProjects(ctx);
}

export async function getCachedInsights(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.insights(ctx.teamId));

  return fetchInsights(ctx);
}
