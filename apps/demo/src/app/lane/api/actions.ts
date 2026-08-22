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
 * **The only way this workspace changes.**
 *
 * Every key the browser reads here is seeded by the route and read with
 * `external`, which makes them server-owned: the client may not publish to them,
 * invalidate them, or edit them in place. So a mutation cannot end at the API
 * call — it has to come back as a *publication*, and the channel for that is the
 * one the framework already owns: mutate the source, ask for the route to render
 * again, and the RSC payload re-streams into `<LaneHydration>`, which republishes
 * every seeded key at once.
 *
 * `refresh()` is that ask, and it is the only granularity RSC offers: a route
 * renders or it does not. There is no "re-read the insights but leave the task
 * list alone". That is fine here because the reads it re-runs are uncached
 * derivations of the thing just mutated (see `api/route-reads.ts`) — the work
 * being repeated is work the mutation invalidated anyway.
 *
 * That is the whole trade. The client-owned variant (`/lane-spa`) pays for
 * immediacy with a cache it must keep honest by hand — publish the task, patch
 * the lists it appears in, invalidate what derives from it, and decide for each
 * of those what "derives" means. Here one round trip republishes the task, every
 * list that contains it, the project counts, and the insights consistently, and
 * nothing has to name that relationship. What it costs is that round trip, which
 * is why the controls that need to feel instant wrap `useOptimistic` around the
 * read value instead.
 */

export async function createTaskAction(
  ctx: WorkspaceCtx,
  input: CreateTaskInput,
): Promise<Task> {
  const task = await createTask(ctx, input);
  refresh();

  return task;
}

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
