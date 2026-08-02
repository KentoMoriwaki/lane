"use client";

import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TeamLabel,
  UpdateTaskInput,
} from "@/server/api";
import { useLane } from "use-lane";
import * as React from "react";
import { useWorkspaceCtx } from "@/app/lane/workspace/workspace-provider";
import {
  addTaskLabelAction,
  createLabelAction,
  createProjectAction,
  createTaskAction,
  deleteTaskAction,
  removeTaskLabelAction,
  updateTaskAction,
} from "./actions";
import type { TaskFilters } from "./endpoints";
import { workspaceReads } from "./lane-reads";

/* -------------------------------- Reads -------------------------------- */

/**
 * The reads pass straight through, and there is nothing to them: every key here
 * is published by the route, so a read is `useLane` over an `external` spec and
 * the value arrives with the payload. No fetch, no freshness policy, and no
 * `invalidate` on the result — the type does not offer one, because converging
 * this data is not the client's move to make.
 */
export function useCurrentUser() {
  return useLane(workspaceReads.currentUser());
}

export function useTeams() {
  return useLane(workspaceReads.teams());
}

export function useTasks(filters: TaskFilters) {
  return useLane(workspaceReads.tasks(filters));
}

export function useTask(taskId: string) {
  return useLane(workspaceReads.task(taskId));
}

export function useProjects() {
  return useLane(workspaceReads.projects());
}

export function useLabels() {
  return useLane(workspaceReads.labels());
}

export function useMembers() {
  return useLane(workspaceReads.members());
}

export function useInsights() {
  return useLane(workspaceReads.insights());
}

/* ------------------------------ Mutations ------------------------------ */

/**
 * Every mutation is the same two steps — call the server action, let the
 * republication it triggers land — so every hook below is the action plus the
 * session, and nothing else. What used to live here was the other half of a
 * write: publish the task, patch each list it belongs to, invalidate the views
 * derived from it. That bookkeeping is not simplified away, it is *relocated* —
 * the server recomputes the whole payload from one database read, so the parts
 * arrive already agreeing with each other.
 *
 * The awaited promise still resolves with the mutated entity, so callers that
 * need it (the create dialog opens the task it just made) keep working; what
 * they must not do is publish it into the lane themselves.
 */
export function useCreateTask() {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (input: CreateTaskInput): Promise<Task> => createTaskAction(ctx, input),
    [ctx],
  );
}

export function useUpdateTask(taskId: string) {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (input: UpdateTaskInput): Promise<Task> =>
      updateTaskAction(ctx, taskId, input),
    [ctx, taskId],
  );
}

export function useDeleteTask() {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (taskId: string): Promise<void> => deleteTaskAction(ctx, taskId),
    [ctx],
  );
}

export function useAddTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (label: TeamLabel): Promise<Task> =>
      addTaskLabelAction(ctx, taskId, label.id),
    [ctx, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (labelId: string): Promise<Task> =>
      removeTaskLabelAction(ctx, taskId, labelId),
    [ctx, taskId],
  );
}

export function useCreateLabel() {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (input: CreateLabelInput): Promise<TeamLabel> =>
      createLabelAction(ctx, input),
    [ctx],
  );
}

export function useCreateProject() {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (input: CreateProjectInput): Promise<Project> =>
      createProjectAction(ctx, input),
    [ctx],
  );
}
