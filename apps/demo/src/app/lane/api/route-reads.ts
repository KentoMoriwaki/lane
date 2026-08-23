import { cacheLife, cacheTag } from "next/cache";
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
 * **When these render is a separate question from what they hold.** A task edit
 * on the list screen does not ask for a render at all: the write's response
 * carries the row and both derivations, and the lane is `set` from it
 * (`api/hooks.ts`). These reads answer the renders that do happen — a load, a
 * navigation, a filter change, a create — and they answer them with the source,
 * which is what keeps a publication authoritative.
 *
 * Projects, labels and members are the other kind: reference data, changed only
 * by the Server Actions in `api/actions.ts`, which name the tag. They are the
 * three reads a background republication does not have to repeat.
 *
 * **A derivation does not get to ride along.** A project used to carry the
 * number of tasks in it, inside the cached read — a value the browser channel
 * changes on every status change and every delete, and cannot expire a tag for.
 * The compromise was a shorter `cacheLife`, which is to say a window in which
 * the server answered with a number it knew to be wrong. The rule above already
 * says what to do instead, so the count is split off into `readProjectTaskCounts`
 * and read dynamically, and `readProjects` is the roster alone: id, name, key,
 * colour — reference data, cached for hours, with no field in it that a task
 * can move. What the browser changes it converges from the write's own response
 * (`lane.set` in `api/hooks.ts`); this read is how the count arrives on a render
 * that was going to happen anyway.
 *
 * `cacheComponents` stays on either way. It is what extracts each route's
 * reusable shell; it does not require these reads to be cached, only that they
 * resolve below a Suspense boundary, which is where the regions put them.
 */

/**
 * A project without its task count — what a cached read of the roster can
 * honestly return. The count comes from {@link readProjectTaskCounts}.
 */
export type ProjectRef = Omit<Project, "taskCount">;

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
  "use cache";
  cacheLife("hours");
  cacheTag(workspaceCacheTags.projects(ctx.teamId));

  // The count is dropped here rather than left unread. A cached read that
  // carries a field the browser channel changes is a stale value waiting for
  // someone to render it; not returning it is what makes that impossible.
  return (await fetchProjects(ctx)).map(
    ({ taskCount: _count, ...project }) => project,
  );
}

/**
 * The task counts, read through on every render like the tasks they are
 * counted from. Cheap, one query, and always the number the list would give.
 */
export async function readProjectTaskCounts(
  ctx: WorkspaceCtx,
): Promise<ProjectTaskCounts> {
  return fetchProjectTaskCounts(ctx);
}

export async function readInsights(ctx: WorkspaceCtx) {
  return fetchInsights(ctx);
}
