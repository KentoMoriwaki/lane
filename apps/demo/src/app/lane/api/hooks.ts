"use client";

import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TaskMutationResult,
  TaskPage,
  TeamLabel,
  UpdateTaskInput,
} from "@/server/api";
import {
  useInfiniteLane,
  useLane,
  useLaneInstance,
  type InfiniteLaneValue,
  type Lane,
} from "use-lane";
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

/**
 * The list — the one read here with a browser half.
 *
 * `useInfiniteLane` over an `external` read: page 1 arrives with the
 * publication and `loadMore` fetches the pages after it from the browser, all
 * under one key. The result carries the actions (`loadMore`, `invalidate`) and
 * `use(promise)` carries the data (`pages`, `hasNext`) — see
 * `workspace/task-list.tsx`.
 *
 * `useWorkspaceCtx()` is what makes the browser's half ask about the same team
 * the route published page 1 for. The lane's own `loaderMeta` cannot: it is
 * built above the frame, where reading the URL would make the frame
 * request-dependent, so it carries empty ids and lets the API default (see
 * `workspace/workspace-provider.tsx`).
 */
export function useTasks(filters: TaskFilters) {
  const ctx = useWorkspaceCtx();

  return useInfiniteLane(workspaceReads.tasks(filters, ctx));
}

export function useTask(taskId: string) {
  return useLane(workspaceReads.task(taskId));
}

export function useProjects() {
  return useLane(workspaceReads.projects());
}

/**
 * The task counts, read apart from the project roster. They are separate Lane
 * keys so a task mutation can publish its confirmed counts without replacing
 * the project metadata beside them.
 */
export function useProjectCounts() {
  return useLane(workspaceReads.projectCounts());
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
 * **Editing a task: no — and on the list screen, not once.** The API answers
 * with everything the edit changed: the task as it now is, and the two numbers
 * derived from it, recomputed by the handler after the write
 * (`server/team/routes.ts`). So the hook calls the embedded API from the
 * browser — same `endpoints.ts` the route reads through, same typed client, no
 * Server Action in the path — and then converges the lane from the answer it is
 * already holding. The list is always on screen beside the detail — both for
 * an intercepted navigation and for a hard-loaded task URL — so nothing here
 * asks the route to render.
 *
 * - `set(task(id))` — the entity that came back, in place, no round trip;
 * - `updateAll(["tasks"])` — the same row patched inside every list holding it,
 *   in whichever *page* holds it and at the index it already occupies.
 *   Membership is not recomputed here: a task that no longer matches a filter
 *   keeps its place until the next publication sorts it out, which is the whole
 *   reason a row never jumps under the cursor. No publication follows this
 *   edit, so the pages the browser loaded stay exactly as they were — nothing
 *   lands on page 1 for the depth to survive;
 * - `set(insights())` and `set(projectCounts())` — the two counts, from the
 *   same response. They are derived from the tasks table and the client cannot
 *   compute them; the *server* can, and it just did, at the moment it knew
 *   they had moved. The strip and the sidebar take the new numbers the way the
 *   row takes its new status — as a value that arrived, not as a reason to read.
 *
 * That is the whole of it: one `PATCH`, four writes, zero reads. `invalidate`
 * would mean *read again*, and there is nothing left to read.
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

export function useUpdateTask(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (input: UpdateTaskInput): Promise<Task> => {
      const result = await updateTask(ctx, taskId, input);
      convergeOnTask(lane, result);

      return result.task;
    },
    [ctx, lane, taskId],
  );
}

export function useDeleteTask() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (taskId: string): Promise<void> => {
      const { insights, projectCounts } = await deleteTask(ctx, taskId);
      lane.updateAll<TaskList>(["tasks"], (list) => withoutRow(list, taskId));
      lane.set(workspaceReads.insights().key, insights);
      lane.set(workspaceReads.projectCounts().key, projectCounts);
      // The `task(id)` entry is left where it is rather than removed. The
      // detail showing it is still mounted while the view moves back to the
      // list, and removing a key under its reader would suspend it into a
      // skeleton on the way out. It is a published value with nothing left to
      // publish it: it expires with the payload that seeded it.
    },
    [ctx, lane],
  );
}

export function useAddTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (label: TeamLabel): Promise<Task> => {
      const result = await addTaskLabel(ctx, taskId, label.id);
      convergeOnTask(lane, result);

      return result.task;
    },
    [ctx, lane, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(
    async (labelId: string): Promise<Task> => {
      const result = await removeTaskLabel(ctx, taskId, labelId);
      convergeOnTask(lane, result);

      return result.task;
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
 * What a confirmed task write does to the lane. One response, four sentences:
 * this is the task, this is what the lists holding it should do about it, and
 * these are the two numbers it moved.
 *
 * Three of the four are `set`, and that is the shape of the claim: **the server
 * said what changed, so nobody has to ask.** The response was computed by the
 * handler that did the write, from the same tables a render would read, one
 * moment later — reading it back would produce the same numbers at the cost of
 * a round trip and a rerender of a screen that is already right.
 *
 * The list keeps the row at its current index while it is being edited. The
 * next route publication remains responsible for re-evaluating membership and
 * order from the server's full data set.
 */
function convergeOnTask(lane: Lane, result: TaskMutationResult) {
  const { task, insights, projectCounts } = result;

  lane.set(workspaceReads.task(task.id).key, task);

  lane.updateAll<TaskList>(["tasks"], (list) => withRowPatched(list, task));

  lane.set(workspaceReads.insights().key, insights);
  lane.set(workspaceReads.projectCounts().key, projectCounts);
}

/**
 * What one of these list entries holds: every page loaded so far, the cursor
 * each was fetched with, and whether there is another. The route publishes the
 * first page in this shape (`api/lane-reads.ts`) and `loadMore` appends to it,
 * so a write that patches a row has to find the row in whichever page holds it.
 */
type TaskList = InfiniteLaneValue<TaskPage, string | null>;

/**
 * The row replaced where it stands — same page, same index. A list that does
 * not hold this task is returned unchanged, and so is every page that does not:
 * the lists the user is not looking at do not mint a new value for a task that
 * was never in them, and a two-page list does not mint a new page 2 for an edit
 * that happened on page 1.
 *
 * Which page a row is on is not a fact this app maintains — it is wherever the
 * page boundary put it, and a row edited here stays on the page it was served
 * on until a publication re-cuts the boundaries. That is the same promise the
 * single-page version made (an edit never moves a row) extended one dimension.
 */
function withRowPatched(list: TaskList, task: Task): TaskList {
  return withPageHolding(list, task.id, (items) =>
    items.map((row) => (row.id === task.id ? task : row)),
  );
}

function withoutRow(list: TaskList, taskId: string): TaskList {
  return withPageHolding(list, taskId, (items) =>
    items.filter((row) => row.id !== taskId),
  );
}

function withPageHolding(
  list: TaskList,
  taskId: string,
  rewrite: (items: Task[]) => Task[],
): TaskList {
  const at = list.pages.findIndex((page) =>
    page.items.some((row) => row.id === taskId),
  );

  if (at === -1) {
    return list;
  }

  return {
    ...list,
    pages: list.pages.map((page, index) =>
      index === at ? { ...page, items: rewrite(page.items) } : page,
    ),
  };
}
