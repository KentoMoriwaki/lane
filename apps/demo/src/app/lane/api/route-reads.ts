import type { Project } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { ApiError } from "./client";
import {
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjectTaskCounts,
  fetchProjects,
  fetchTask,
  fetchTaskPage,
  fetchTasks,
  fetchTeams,
  type ProjectTaskCounts,
  type TaskFilters,
} from "./endpoints";

/**
 * Everything the server-owned route reads, deliberately uncached.
 *
 * This demo is focused on the fully dynamic App Router shape: every route
 * generation reads its source, and every publication therefore describes that
 * generation's current data. That keeps the answer to "which mutation changes
 * which derived read" implicit — a mutation changes the source, and the next
 * render reads the source — instead of maintaining a parallel tag graph.
 *
 * **When these render is a separate question from what they hold.** A task edit
 * on the list screen does not ask for a render at all: the write's response
 * carries the row and both derivations, and the lane is `set` from it
 * (`api/hooks.ts`). These reads answer the renders that do happen — a load, a
 * navigation, a filter change, a create — and they answer them with the source,
 * which is what keeps a publication authoritative.
 *
 * Project metadata and task-derived project counts remain separate reads and
 * separate Lane keys. The split lets a task mutation publish the confirmed
 * count it received without replacing the roster, while a route generation
 * still reads both dynamically from the same source.
 *
 * `cacheComponents` stays on. It extracts each route's reusable shell without
 * making these data reads persistent cache entries; they resolve below the
 * Suspense boundaries in `regions.tsx`.
 */

/**
 * A project without its task count. The count is published through its own
 * read so a task mutation can converge that derived value independently.
 */
export type ProjectRef = Omit<Project, "taskCount">;

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

/**
 * **The first page of the list — the part of it that belongs to this route.**
 *
 * `/lane`'s list is infinite on one key: the route reads page 1 and publishes
 * it, and the browser reads pages 2..n with the cursor each page hands back
 * (`api/lane-reads.ts`). So this read takes the cursor it starts from, and the
 * regions pass `null` — a route always publishes the *first* page, whatever
 * depth the browser has reached on top of it, because a publication is what the
 * route can state and depth is not (see `docs/api-reference.md` §
 * `useInfiniteLane` → "The first page from the route").
 */
export async function readTasks(
  ctx: WorkspaceCtx,
  filters: TaskFilters,
  page: { cursor: string | null },
) {
  return fetchTaskPage(ctx, filters, { cursor: page.cursor });
}

/**
 * The list entire, for `/app-router` — the baseline route, which hands the
 * whole thing down as props and has no browser-side half to deepen it.
 */
export async function readAllTasks(ctx: WorkspaceCtx, filters: TaskFilters) {
  return fetchTasks(ctx, filters);
}

export async function readTask(ctx: WorkspaceCtx, taskId: string) {
  try {
    return await fetchTask(ctx, taskId);
  } catch (error) {
    // A URL can name a task that is gone — a shared link to something deleted
    // since, or a render that reaches this read while the browser is still
    // moving off a task it just removed. Missing is an ordinary snapshot state
    // here, not a failed read.
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function readProjects(ctx: WorkspaceCtx): Promise<ProjectRef[]> {
  // The count travels through its own read and Lane key, so this one publishes
  // only the project roster even though the endpoint returns both.
  return (await fetchProjects(ctx)).map(
    ({ taskCount: _count, ...project }) => project,
  );
}

/**
 * The task counts, read dynamically on every route generation like the tasks
 * they are counted from. Cheap, one query, and always the number the list would
 * give.
 */
export async function readProjectTaskCounts(
  ctx: WorkspaceCtx,
): Promise<ProjectTaskCounts> {
  return fetchProjectTaskCounts(ctx);
}

export async function readInsights(ctx: WorkspaceCtx) {
  return fetchInsights(ctx);
}
