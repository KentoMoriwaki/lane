import { cacheLife, cacheTag } from "next/cache";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import {
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
 * - membership: which teams and people the current context can see
 * - reference: stable picker data that has its own mutations
 * - board: tasks and every value derived from those tasks
 */
export const workspaceCacheTags = {
  userMembership: (userId: string) => `lane:membership:user:${userId}`,
  teamMembership: (teamId: string) => `lane:membership:team:${teamId}`,
  reference: (teamId: string) => `lane:reference:${teamId}`,
  board: (teamId: string) => `lane:board:${teamId}`,
};

export async function getCachedTeams(userId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.userMembership(userId));

  return fetchTeams({ userId, teamId: "" });
}

export async function getCachedMembers(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.teamMembership(ctx.teamId));

  return fetchMembers(ctx);
}

export async function getCachedLabels(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.reference(ctx.teamId));

  return fetchLabels(ctx);
}

export async function getCachedTasks(ctx: WorkspaceCtx, filters: TaskFilters) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.board(ctx.teamId));

  return fetchTasks(ctx, filters);
}

export async function getCachedTask(ctx: WorkspaceCtx, taskId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.board(ctx.teamId));

  return fetchTask(ctx, taskId);
}

export async function getCachedProjects(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.board(ctx.teamId));

  return fetchProjects(ctx);
}

export async function getCachedInsights(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("max");
  cacheTag(workspaceCacheTags.board(ctx.teamId));

  return fetchInsights(ctx);
}
