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
 * Everything the server-owned route reads, and the line between what is cached
 * and what is not.
 *
 * That line is not "expensive versus cheap". It is **which channel mutates the
 * data** (`docs/integrations.md` § The two mutation channels):
 *
 * > A read whose data the browser changes through the Route Handler channel
 * > stays dynamic. A Route Handler cannot bump the client router's cache, and a
 * > `"use cache"` segment is served straight from the prefetch for its
 * > `cacheLife` `stale` window — so a navigation would paint the pre-mutation
 * > copy and republish it over the write that already landed, and the edit
 * > would disappear from the screen. Data that is both cached and mutable is
 * > changed by a Server Action calling `updateTag`, which expires the entry and
 * > bumps the router's copy in the same response.
 *
 * So the tasks, the selected task, the insights and the session read through to
 * the source on every render: every one of them is written, or derived from
 * what is written, by the browser channel in `api/hooks.ts`. Reading a
 * derivation through also keeps the answer to "which mutation changes which
 * derived read" implicit — a mutation changes the source, the next render reads
 * the source — which is a table nobody has to maintain.
 *
 * Projects, labels and members are the other kind: reference data, changed only
 * by the Server Actions in `api/actions.ts`, which name the tag. They are the
 * three reads a background republication does not have to repeat.
 *
 * One derivation rides along inside a cached read, and it is worth naming
 * rather than hiding: a project carries the number of tasks in it. Creating a
 * task expires the projects tag, so that count follows the create. Deleting a
 * task or moving it between projects goes through the browser channel and
 * cannot expire anything, so those counts converge on the profile's
 * `revalidate` instead — which is why the profile here is `minutes` and not
 * `max`.
 *
 * `cacheComponents` stays on either way. It is what extracts each route's
 * reusable shell; it does not require these reads to be cached, only that they
 * resolve below a Suspense boundary, which is where the regions put them.
 */

/**
 * The tags the cached reads below declare, and the only names `api/actions.ts`
 * may expire. Team-scoped, because the reads are: the active team travels in
 * request headers, so it has to travel in the cache key too.
 */
export const workspaceCacheTags = {
  projects: (teamId: string) => `projects:${teamId}`,
  labels: (teamId: string) => `labels:${teamId}`,
  members: (teamId: string) => `members:${teamId}`,
};

export async function readCurrentUser(userId: string) {
  return fetchCurrentUser({ userId, teamId: "" });
}

export async function readTeams(userId: string) {
  return fetchTeams({ userId, teamId: "" });
}

export async function readMembers(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("hours");
  cacheTag(workspaceCacheTags.members(ctx.teamId));

  return fetchMembers(ctx);
}

export async function readLabels(ctx: WorkspaceCtx) {
  "use cache";
  cacheLife("hours");
  cacheTag(workspaceCacheTags.labels(ctx.teamId));

  return fetchLabels(ctx);
}

export async function readTasks(ctx: WorkspaceCtx, filters: TaskFilters) {
  return fetchTasks(ctx, filters);
}

export async function readTask(ctx: WorkspaceCtx, taskId: string) {
  try {
    return await fetchTask(ctx, taskId);
  } catch (error) {
    // A task deleted in the browser is still named by the URL until the client
    // clears the selection, and the background rerender can reach this read
    // first. Missing is an ordinary snapshot state here, not a failed read.
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function readProjects(ctx: WorkspaceCtx) {
  "use cache";
  // Shorter than the other two because of the task count a project carries:
  // the mutations that can change it without expiring the tag are the ones the
  // browser channel owns.
  cacheLife("minutes");
  cacheTag(workspaceCacheTags.projects(ctx.teamId));

  return fetchProjects(ctx);
}

export async function readInsights(ctx: WorkspaceCtx) {
  return fetchInsights(ctx);
}
