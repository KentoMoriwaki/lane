"use server";

import { refresh } from "next/cache";
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
 * Every route read in `/lane` is dynamic, so each of these mutations makes the
 * same ask: `refresh()` re-renders the route in the Server Action response and
 * every region publishes the current source value. There is no data-cache tag
 * graph beside that route generation.
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
  // the list, the insights and the project counts — is read dynamically.
  refresh();

  return task;
}

export async function createLabelAction(
  ctx: WorkspaceCtx,
  input: CreateLabelInput,
): Promise<TeamLabel> {
  const label = await createLabel(ctx, input);
  refresh();

  return label;
}

export async function createProjectAction(
  ctx: WorkspaceCtx,
  input: CreateProjectInput,
): Promise<Project> {
  const project = await createProject(ctx, input);
  refresh();

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
 * `refresh()` alone is the ask. `/lane` has no persistent data-cache entries to
 * expire; every route generation reads the source dynamically.
 *
 * The endpoints answer with the task *and* the two derivations that moved with
 * it; these actions keep the task and drop the rest. That is not waste being
 * tolerated — it is the difference between the channels stated in one line. A
 * route that is about to be re-rendered gets its counters from the render; only
 * a caller that refuses to re-render needs them in the response.
 */

export async function updateTaskAction(
  ctx: WorkspaceCtx,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const { task } = await updateTask(ctx, taskId, input);
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
  const { task } = await addTaskLabel(ctx, taskId, labelId);
  refresh();

  return task;
}

export async function removeTaskLabelAction(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const { task } = await removeTaskLabel(ctx, taskId, labelId);
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
