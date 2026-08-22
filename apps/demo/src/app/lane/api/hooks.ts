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
import { useLane, useLaneInstance, type Lane } from "use-lane";
import * as React from "react";
import { useWorkspaceCtx } from "@/app/lane/workspace/workspace-provider";
import {
  createLabelAction,
  createProjectAction,
  createTaskAction,
} from "./actions";
import {
  addTaskLabel,
  deleteTask,
  removeTaskLabel,
  updateTask,
  type TaskFilters,
} from "./endpoints";
import { workspaceReads } from "./lane-reads";

/* -------------------------------- Reads -------------------------------- */

/**
 * The reads pass straight through, and there is nothing to them: every key here
 * is published by the route, so a read is `useLane` over an `external` spec and
 * the value arrives with the payload. No fetch and no freshness policy — an
 * `external` read has no loader to instruct, and freshness belongs to the owner
 * that publishes.
 *
 * `invalidate` is on the result like on any other read, and it means the same
 * thing: mark this key stale. What differs is who answers — Lane asks the owner
 * to render again (`refresh`, wired in `WorkspaceProvider`) and the value
 * arrives as the next publication.
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
 * **Two channels, one route** (`docs/integrations.md` § The two mutation
 * channels). The question each mutation answers is *"do I want the screen read
 * again?"*, and this workspace answers it both ways.
 *
 * **Editing a task: no.** The API answers with the task as it now is, and every
 * key that has to change is either that task or something derived from it. So
 * the hook calls the embedded API from the browser — same `endpoints.ts` the
 * route reads through, same typed client, no Server Action in the path — and
 * then converges the lane itself:
 *
 * - `set(task(id))` — the entity that came back, in place, no round trip;
 * - `updateAll(["tasks"])` — the same row patched inside every list holding it,
 *   at the index it already occupies. Membership is not recomputed here: a task
 *   that no longer matches a filter keeps its place until the next publication
 *   sorts it out, which is the whole reason a row never jumps under the cursor;
 * - `invalidate(insights())` — the counters, which nothing in the response can
 *   compute. Marking them is all this does: the mounted strip re-reads, Lane
 *   asks the owner once, and the route's next publication answers.
 *
 * That last line is the only re-render, it happens in the background, and it
 * carries the whole route with it — the sorted list, the counters, the sidebar.
 * The client never has to decide what "derives" means; it only has to say which
 * key it could not compute.
 *
 * **Creating anything: yes.** A new task, project, or label has a *position*
 * nobody here can work out — where it sorts, which pickers list it. Those go
 * through `actions.ts`, and the action's response is the re-rendered route.
 *
 * What is left over — the API round trip on an inline edit — is covered by
 * `useOptimistic` over the read value in the detail panel and the row, which is
 * a display concern and never a write.
 */

export function useUpdateTask(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (input: UpdateTaskInput): Promise<Task> => {
      const task = await updateTask(ctx, taskId, input);
      convergeOnTask(lane, task);

      return task;
    },
    [ctx, lane, taskId],
  );
}

export function useDeleteTask() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (taskId: string): Promise<void> => {
      await deleteTask(ctx, taskId);
      lane.updateAll<Task[]>(["tasks"], (tasks) => withoutRow(tasks, taskId));
      lane.invalidate(workspaceReads.insights().key);
      // The `task(id)` entry is left where it is rather than removed. The panel
      // showing it is still mounted while the selection clears, and removing a
      // key under its reader would suspend it into a skeleton on the way out.
      // It is a published value with nothing left to publish it: it expires
      // with the payload that seeded it.
    },
    [ctx, lane],
  );
}

export function useAddTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (label: TeamLabel): Promise<Task> => {
      const task = await addTaskLabel(ctx, taskId, label.id);
      convergeOnTask(lane, task);

      return task;
    },
    [ctx, lane, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (labelId: string): Promise<Task> => {
      const task = await removeTaskLabel(ctx, taskId, labelId);
      convergeOnTask(lane, task);

      return task;
    },
    [ctx, lane, taskId],
  );
}

/**
 * The create paths call the action and do nothing else. Their answer is the
 * re-rendered route travelling back in the same response — publishing the
 * returned entity into the lane on top of it would only be a second, worse copy
 * of what is already arriving.
 */
export function useCreateTask() {
  const ctx = useWorkspaceCtx();

  return React.useCallback(
    (input: CreateTaskInput): Promise<Task> => createTaskAction(ctx, input),
    [ctx],
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

/**
 * What a confirmed task does to the lane. One entity, three sentences: this is
 * it, it looks like this wherever it is listed, and the numbers computed from
 * it are stale.
 */
function convergeOnTask(lane: Lane, task: Task) {
  lane.set(workspaceReads.task(task.id).key, task);
  lane.updateAll<Task[]>(["tasks"], (tasks) => withRowPatched(tasks, task));
  lane.invalidate(workspaceReads.insights().key);
}

/**
 * The row replaced where it stands. A list that does not hold this task is
 * returned unchanged — same array, so the lists the user is not looking at do
 * not mint a new value for a task that was never in them.
 */
function withRowPatched(tasks: Task[], task: Task): Task[] {
  return tasks.some((row) => row.id === task.id)
    ? tasks.map((row) => (row.id === task.id ? task : row))
    : tasks;
}

function withoutRow(tasks: Task[], taskId: string): Task[] {
  return tasks.some((row) => row.id === taskId)
    ? tasks.filter((row) => row.id !== taskId)
    : tasks;
}
