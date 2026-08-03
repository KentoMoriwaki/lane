"use server";

import { updateTag } from "next/cache";
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
import { getTaskUpdateDerivedImpact } from "./cache-policy";
import { workspaceCacheTags } from "./cached-endpoints";

/**
 * **The only way this workspace changes.**
 *
 * Every key the browser reads here is seeded by the route and read with
 * `external`, which makes them server-owned: the client may not publish to them,
 * invalidate them, or edit them in place. So a mutation cannot end at the API
 * call — it has to come back as a *publication*, and the channel for that is the
 * one the framework already owns: mutate, expire the affected cache domains,
 * and the RSC payload re-streams into `<LaneHydration>`, which republishes every
 * seeded key at once.
 *
 * That is the whole trade. The client-owned variant (`/lane-spa`) pays for
 * immediacy with a cache it must keep honest by hand — publish the task, patch
 * the lists it appears in, invalidate what derives from it, and decide for each
 * of those what "derives" means. Here one round trip republishes the task, every
 * list that contains it, the project counts, and the insights consistently.
 * Reads unaffected by the mutation stay warm; the next publication combines
 * those cache hits with the freshly recomputed domains. What it costs is that
 * round trip, which is why the controls that need to feel instant wrap
 * `useOptimistic` around the read value instead.
 *
 * The tags are not a duplicate of Lane's keys. They name server coherence
 * domains. The mutation input tells us which derived reads can change, while
 * `updateTag` gives the mutating user read-your-own-writes behavior on the next
 * publication.
 */

function expire(...tags: string[]) {
  for (const tag of tags) {
    updateTag(tag);
  }
}

export async function createTaskAction(
  ctx: WorkspaceCtx,
  input: CreateTaskInput,
): Promise<Task> {
  const task = await createTask(ctx, input);
  expire(
    workspaceCacheTags.taskLists(ctx.teamId),
    workspaceCacheTags.insights(ctx.teamId),
  );
  if (input.projectId) {
    updateTag(workspaceCacheTags.projects(ctx.teamId));
  }
  return task;
}

export async function updateTaskAction(
  ctx: WorkspaceCtx,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const task = await updateTask(ctx, taskId, input);
  const derived = getTaskUpdateDerivedImpact(input);
  expire(
    workspaceCacheTags.taskLists(ctx.teamId),
    workspaceCacheTags.task(ctx.teamId, taskId),
  );
  if (derived.insights) {
    updateTag(workspaceCacheTags.insights(ctx.teamId));
  }
  if (derived.projects) {
    updateTag(workspaceCacheTags.projects(ctx.teamId));
  }
  return task;
}

export async function deleteTaskAction(
  ctx: WorkspaceCtx,
  taskId: string,
): Promise<void> {
  await deleteTask(ctx, taskId);
  expire(
    workspaceCacheTags.taskLists(ctx.teamId),
    workspaceCacheTags.task(ctx.teamId, taskId),
    workspaceCacheTags.projects(ctx.teamId),
    workspaceCacheTags.insights(ctx.teamId),
  );
}

export async function addTaskLabelAction(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const task = await addTaskLabel(ctx, taskId, labelId);
  expire(
    workspaceCacheTags.taskLists(ctx.teamId),
    workspaceCacheTags.task(ctx.teamId, taskId),
  );
  return task;
}

export async function removeTaskLabelAction(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const task = await removeTaskLabel(ctx, taskId, labelId);
  expire(
    workspaceCacheTags.taskLists(ctx.teamId),
    workspaceCacheTags.task(ctx.teamId, taskId),
  );
  return task;
}

export async function createLabelAction(
  ctx: WorkspaceCtx,
  input: CreateLabelInput,
): Promise<TeamLabel> {
  const label = await createLabel(ctx, input);
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

/**
 * The manual refresh, expressed as what it now is: a request to the owner to
 * publish again.
 *
 * It reads something first, and that is not ceremony. Cache invalidation itself
 * cannot report whether the data source is reachable. Touching the source gives
 * the refresh an outcome to report; the chip in the task list shows the
 * rejection, and the publication on screen stays exactly as it was. An explicit
 * refresh expires every domain because the user asked for the whole
 * workspace, unlike a mutation with a known impact.
 */
export async function refreshWorkspaceAction(ctx: WorkspaceCtx): Promise<void> {
  await fetchInsights(ctx);
  expire(
    workspaceCacheTags.currentUser(),
    workspaceCacheTags.teams(ctx.userId),
    workspaceCacheTags.members(ctx.teamId),
    workspaceCacheTags.labels(ctx.teamId),
    workspaceCacheTags.taskLists(ctx.teamId),
    workspaceCacheTags.taskDetails(ctx.teamId),
    workspaceCacheTags.projects(ctx.teamId),
    workspaceCacheTags.insights(ctx.teamId),
  );
}
