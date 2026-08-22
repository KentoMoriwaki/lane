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
 * Everything the server-owned routes read, and nothing else.
 *
 * These reads are deliberately uncached. Most of this workspace *derives* from
 * the task table — the lists, the selected task, the insight counters, the
 * per-project task counts — and caching a derivation is what forces someone to
 * answer "which mutation can change which derived read". That question has no
 * cheap answer, so it becomes a table that has to be maintained by hand and is
 * wrong the moment a field is added. Reading through keeps the answer implicit:
 * a mutation changes the source, the next render reads the source.
 *
 * The cost is a re-read per publication, which is small here because the server
 * is colocated with the API — its transport delay is a fraction of the browser's
 * (see `server/team/latency.ts`) and the reads below run concurrently.
 *
 * `cacheComponents` stays on. It is what extracts each route's reusable shell;
 * it does not require these reads to be cached, only that they resolve below a
 * Suspense boundary, which is where both routes put them.
 */

export async function readCurrentUser(userId: string) {
  return fetchCurrentUser({ userId, teamId: "" });
}

export async function readTeams(userId: string) {
  return fetchTeams({ userId, teamId: "" });
}

export async function readMembers(ctx: WorkspaceCtx) {
  return fetchMembers(ctx);
}

export async function readLabels(ctx: WorkspaceCtx) {
  return fetchLabels(ctx);
}

export async function readTasks(ctx: WorkspaceCtx, filters: TaskFilters) {
  return fetchTasks(ctx, filters);
}

export async function readTask(ctx: WorkspaceCtx, taskId: string) {
  try {
    return await fetchTask(ctx, taskId);
  } catch (error) {
    // Deleting the task selected in the URL rerenders that URL in the same
    // Server Action response, before the client clears the selection. Missing
    // is an ordinary snapshot state here, not a failed read.
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function readProjects(ctx: WorkspaceCtx) {
  return fetchProjects(ctx);
}

export async function readInsights(ctx: WorkspaceCtx) {
  return fetchInsights(ctx);
}
