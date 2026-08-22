"use server";

import { refresh, updateTag } from "next/cache";
import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TeamLabel,
  UpdateTaskInput,
} from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import {
  addTaskLabel,
  createLabel,
  createProject,
  createTask,
  deleteTask,
  fetchInsights,
  removeTaskLabel,
  updateTask,
} from "./endpoints";
import { workspaceCacheTags } from "./route-reads";

/**
 * **The mutations that want the screen read again.**
 *
 * This is one of the two channels the workspace mutates through (see
 * `docs/integrations.md` § The two mutation channels). The axis is not "server
 * or client" but *"do I want this screen read again?"* — and for the three
 * mutations below the answer is yes, because what they change is a position
 * rather than a value: a created task belongs somewhere in a sorted list, a new
 * project or label belongs in every picker and filter that lists them. Nothing
 * the client holds can place them, so the honest answer is a read.
 *
 * A Server Action is what carries that: the response is the re-rendered route,
 * so the read costs no extra round trip, and `<LaneHydration>` republishes
 * every seeded key from it.
 *
 * Which ask each mutation makes depends on where its data lives:
 *
 * - `refresh()` re-renders the route without expiring anything. It is enough
 *   for tasks and insights, which are read dynamically (`api/route-reads.ts`).
 * - `updateTag(tag)` expires a `"use cache"` entry *and* re-renders the route in
 *   the same response, which is the only way to change cached data honestly:
 *   the client router's copy is bumped with it, so a later navigation cannot
 *   paint the pre-mutation version.
 *
 * Everything a user edits on an existing task — status, title, priority,
 * assignee, project, due date, labels, deletion — goes the other way in
 * `/lane`: from the browser to the API and back into the lane in place
 * (`api/hooks.ts`). The bottom of this file keeps those same edits as Server
 * Actions for `/app-router`, which is the route that answers the other way.
 */

export async function createTaskAction(
  ctx: WorkspaceCtx,
  input: CreateTaskInput,
): Promise<Task> {
  const task = await createTask(ctx, input);
  // Re-rendering the route is the whole ask. Everything a new task changes —
  // the list, the insights, the project counts — is read dynamically
  // (`api/route-reads.ts`); the cached reads hold reference data a task cannot
  // touch, so there is no tag to expire here.
  refresh();

  return task;
}

export async function createLabelAction(
  ctx: WorkspaceCtx,
  input: CreateLabelInput,
): Promise<TeamLabel> {
  const label = await createLabel(ctx, input);
  // No `refresh()` beside it: expiring a tag re-renders the current route by
  // itself, and the response carries that render. Asking twice would only mean
  // rendering the route against a cache entry that is already gone.
  updateTag(workspaceCacheTags.labels(ctx.teamId));

  return label;
}

export async function createProjectAction(
  ctx: WorkspaceCtx,
  input: CreateProjectInput,
): Promise<Project> {
  const project = await createProject(ctx, input);
  updateTag(workspaceCacheTags.projects(ctx.teamId));

  return project;
}

/* ------------------- The props baseline's task mutations ------------------ */

/**
 * `/app-router` — the plain-props comparison — has one channel, and this is it:
 * every task edit is a Server Action that mutates and asks for a rerender, and
 * the whole route comes back as props. These live here because that route
 * shares this one's endpoints, reads, and URL state; what the two routes differ
 * in is how a change converges, which is the comparison.
 *
 * `/lane` calls none of them. Its task edits go from the browser to the API and
 * into the lane in place (`api/hooks.ts`).
 *
 * None of them expires a tag: `refresh()` alone is the ask, because no cached
 * read holds anything a task can change. The project task counts used to be the
 * exception, and `route-reads.ts` says why they are their own dynamic read now.
 */

export async function updateTaskAction(
  ctx: WorkspaceCtx,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const task = await updateTask(ctx, taskId, input);
  refresh();

  return task;
}

export async function deleteTaskAction(
  ctx: WorkspaceCtx,
  taskId: string,
): Promise<void> {
  await deleteTask(ctx, taskId);
  refresh();
}

export async function addTaskLabelAction(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const task = await addTaskLabel(ctx, taskId, labelId);
  refresh();

  return task;
}

export async function removeTaskLabelAction(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const task = await removeTaskLabel(ctx, taskId, labelId);
  refresh();

  return task;
}

/**
 * The manual refresh, expressed as what it is: a request to the owner to
 * publish again.
 *
 * It reads something first, and that is not ceremony. Asking for a rerender
 * cannot report whether the data source is reachable — the render happens after
 * this action returns, and a failure inside it surfaces as a broken route rather
 * than as an answer. Touching the source here gives the refresh an outcome the
 * caller can catch: the chip in the task list shows the rejection, and the
 * publication on screen stays exactly as it was.
 */
export async function refreshWorkspaceAction(ctx: WorkspaceCtx): Promise<void> {
  await fetchInsights(ctx);
  refresh();
}
