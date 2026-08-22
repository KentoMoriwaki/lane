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
import type { TaskSurface } from "@/app/lane/regions";
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
 * then converges the lane itself. What that convergence *is* depends on where
 * the edit was made, which is the `surface` every one of these hooks takes:
 *
 * **`"panel"` — the list is on screen beside the detail.** The intercepted
 * panel, and the status control on a row.
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
 * **`"page"` — no list is on screen.** The full task page at
 * `/lane/task/<id>`, which is what a direct visit, a reload, or a shared link
 * renders.
 *
 * - `set(task(id))` — the same;
 * - `invalidateAll(["tasks"])` — every list entry this lane holds is marked
 *   stale rather than rewritten. Patching a row nobody is looking at would only
 *   guess at a sort order the server owns, and there is no jump to avoid;
 * - `invalidate(insights())` — the same.
 *
 * Nothing is *asked* by the second form while the page is up: a marked key with
 * no reader stays marked. The ask comes when a list is revealed again — the
 * reader finds its entry stale, suspends into the list's fallback, Lane asks
 * the owner once, and the publication that answers is a freshly sorted list
 * with the edited task in its new place. That is the same shape a
 * `revalidatePath` and a Back would have produced, arrived at without reading
 * anything until someone looked.
 *
 * Which list entries the page's lane actually holds depends on how it was
 * reached: a reload lands on a lane with none, and the navigation back to the
 * list reads it fresh anyway. Marking them is what makes the case where it
 * *does* hold one — a soft navigation out to the page and back — behave the
 * same as the case where it does not.
 *
 * A note on getting *into* the panel: it opens by `<Link>`, on purpose. Browser
 * back and forward into an intercepted URL always re-suspend, because the RSC
 * payload for it varies on `Next-Url` and the router has no cached copy of the
 * intercepted form (measured in `apps/activity-lab`; Next's behavior, not
 * Lane's).
 *
 * **Creating anything: yes.** A new task, project, or label has a *position*
 * nobody here can work out — where it sorts, which pickers list it. Those go
 * through `actions.ts`, and the action's response is the re-rendered route.
 *
 * What is left over — the API round trip on an inline edit — is covered by
 * `useOptimistic` over the read value in the detail and the row, which is a
 * display concern and never a write.
 */

export function useUpdateTask(taskId: string, surface: TaskSurface) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (input: UpdateTaskInput): Promise<Task> => {
      const task = await updateTask(ctx, taskId, input);
      convergeOnTask(lane, task, surface);

      return task;
    },
    [ctx, lane, surface, taskId],
  );
}

export function useDeleteTask(surface: TaskSurface) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (taskId: string): Promise<void> => {
      await deleteTask(ctx, taskId);
      if (surface === "panel") {
        lane.updateAll<Task[]>(["tasks"], (tasks) => withoutRow(tasks, taskId));
      } else {
        lane.invalidateAll(["tasks"]);
      }
      lane.invalidate(workspaceReads.insights().key);
      // The `task(id)` entry is left where it is rather than removed. The
      // detail showing it is still mounted while the view moves back to the
      // list, and removing a key under its reader would suspend it into a
      // skeleton on the way out. It is a published value with nothing left to
      // publish it: it expires with the payload that seeded it.
    },
    [ctx, lane, surface],
  );
}

export function useAddTaskLabel(taskId: string, surface: TaskSurface) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (label: TeamLabel): Promise<Task> => {
      const task = await addTaskLabel(ctx, taskId, label.id);
      convergeOnTask(lane, task, surface);

      return task;
    },
    [ctx, lane, surface, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string, surface: TaskSurface) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (labelId: string): Promise<Task> => {
      const task = await removeTaskLabel(ctx, taskId, labelId);
      convergeOnTask(lane, task, surface);

      return task;
    },
    [ctx, lane, surface, taskId],
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
 * it, this is what the lists holding it should do about it, and the numbers
 * computed from it are stale.
 *
 * Only the middle sentence differs by surface, and it is the same distinction
 * either way — *is anyone looking at a list right now?* With the list beside
 * the detail, rewriting the row is what keeps it from moving under the cursor.
 * Without one, marking is strictly better: no order is guessed, and nothing is
 * read until a list is on screen to read it for.
 */
function convergeOnTask(lane: Lane, task: Task, surface: TaskSurface) {
  lane.set(workspaceReads.task(task.id).key, task);

  if (surface === "panel") {
    lane.updateAll<Task[]>(["tasks"], (tasks) => withRowPatched(tasks, task));
  } else {
    lane.invalidateAll(["tasks"]);
  }

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
