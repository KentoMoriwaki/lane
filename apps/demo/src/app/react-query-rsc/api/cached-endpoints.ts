import { cacheLife, cacheTag } from "next/cache";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { ApiError } from "./client";
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
 * The tagged server generation this route dehydrates into the browser.
 *
 * These reads used to be shared with `/lane`, which is why they lived under
 * `app/lane/api`. `/lane` reads through to the source now — caching a
 * derivation is what forces someone to maintain "which mutation invalidates
 * which derived read" — so the tags belong to the one route that still makes
 * them its subject. This lab exists to show a tagged generation merging into a
 * mutable `QueryClient`, and `updateTag` is what produces that generation.
 *
 * Task lists, task details, project counts, and insights have different
 * dependencies. Keeping them separate lets a mutation expire only the reads it
 * can actually change.
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

  try {
    return await fetchTask(ctx, taskId);
  } catch (error) {
    // Deleting the task selected in the URL can rerender that URL in the same
    // Server Action response, before the client clears the selection. Missing
    // is an ordinary snapshot state here; keeping it inside the cached read
    // also avoids reporting an expected 404 as a rejected Cache Component.
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
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
