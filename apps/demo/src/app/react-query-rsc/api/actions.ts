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
import { getTaskUpdateDerivedImpact } from "./cache-policy";
import { workspaceCacheTags } from "./cached-endpoints";
import type { WorkspaceCtx } from "./client";
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
 * React Query's experimental Next-converged mutation channel.
 *
 * These actions intentionally spell out the same coherence domains as the
 * server-owned variants instead of hiding the comparison behind an adapter.
 * `updateTag` makes Next include a fresh render of the current route in the
 * action's Flight response. That render fills a new server QueryClient from
 * the tagged reads, dehydrates it, and lets `HydrationBoundary` merge the
 * authoritative generation into the one long-lived browser QueryClient.
 *
 * The returned mutation value is still useful for control flow (for example,
 * selecting a newly created task), but it is not published into the cache on
 * the client. Cache convergence comes from the RSC payload.
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

export async function refreshWorkspaceAction(
  ctx: WorkspaceCtx,
): Promise<void> {
  // Probe the source first so a failed manual refresh leaves the current cache
  // generation intact instead of expiring it and then discovering the outage.
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
