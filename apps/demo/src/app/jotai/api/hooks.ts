"use client";

import type { TeamLabel, UpdateTaskInput } from "@/server/api";
import { useAtomValue, useSetAtom, useStore, type WritableAtom } from "jotai";
import * as React from "react";
import {
  activeTeamIdAtom,
  addTaskLabelAtom,
  blockedByAtomFamily,
  blockingAtomFamily,
  type Commit,
  createLabelAtom,
  createProjectAtom,
  createTaskAtom,
  currentTasksAtom,
  currentUserAtom,
  deleteTaskAtom,
  insightsAtom,
  labelsAtom,
  membersAtom,
  projectsAtom,
  refreshWorkspaceAtom,
  removeTaskLabelAtom,
  selectedTaskAtom,
  selectedTaskIdAtom,
  taskAtomFamily,
  type TaskKey,
  teamsAtom,
  updateTaskAtom,
} from "./atoms";
import type { QueryAtom } from "./query-atom";
import type { TaskCacheStrategy } from "./task-cache-sync";
import { useWorkspaceTransition } from "./workspace-transition";

/* -------------------------------- Reads -------------------------------- */

/**
 * Every read is one `useAtomValue`. It returns the resolved value — jotai
 * unwraps the atom's promise with `use`, so the component suspends on first
 * load and keeps rendering the previous value while a transition replaces it.
 * There is no status object to branch on and no `enabled` flag: a read with
 * nothing to fetch simply resolves.
 */
export function useCurrentUser() {
  return useAtomValue(currentUserAtom);
}

export function useTeams() {
  return useAtomValue(teamsAtom);
}

/**
 * The task list and the open task take no argument: both are derived from the
 * view atoms, so a component asks for "the current list" and the graph decides
 * which cached read that is.
 */
export function useTasks() {
  return useAtomValue(currentTasksAtom);
}

export function useSelectedTask() {
  return useAtomValue(selectedTaskAtom);
}

export function useProjects() {
  return useAtomValue(projectsAtom);
}

export function useLabels() {
  return useAtomValue(labelsAtom);
}

export function useMembers() {
  return useAtomValue(membersAtom);
}

export function useInsights() {
  return useAtomValue(insightsAtom);
}

export function useBlockedByTasks(taskId: string) {
  return useAtomValue(blockedByAtomFamily(useTaskKey(taskId)));
}

export function useBlockingTasks(taskId: string) {
  return useAtomValue(blockingAtomFamily(useTaskKey(taskId)));
}

/** Per-task reads are keyed by team as well as id (see `atoms.ts`). */
function useTaskKey(taskId: string): TaskKey {
  const teamId = useAtomValue(activeTeamIdAtom);
  return React.useMemo(() => ({ teamId, taskId }), [teamId, taskId]);
}

/* ------------------------------ Mutations ------------------------------ */

/**
 * A mutation is a write-only atom, so binding it is just `useSetAtom`. The
 * setter hands back the write function's promise, which is what lets these stay
 * plain async calls that a transition or `useActionState` can await.
 *
 * What this adds is the `commit` every mutation takes (see `Commit` in
 * `atoms.ts`): the writes it makes once its request resolves are past an
 * `await`, so they need a transition of their own or they blank the reads they
 * land in.
 *
 * The transition bound here is the list one. An edit is not only a change to
 * the open task: it patches or refetches every cached list the edited field
 * could have moved the task in or out of, so the list is being replaced and
 * says so the same way a filter change does. Where the edit *came from* is
 * reported separately, by the detail panel's own "Saving…".
 */
function useMutation<Args extends unknown[], Result>(
  mutationAtom: WritableAtom<null, [Commit, ...Args], Promise<Result>>,
): (...args: Args) => Promise<Result> {
  const run = useSetAtom(mutationAtom);
  const { startTransition } = useWorkspaceTransition();
  return React.useCallback(
    (...args: Args) => run(startTransition, ...args),
    [run, startTransition],
  );
}

export function useCreateTask() {
  return useMutation(createTaskAtom);
}

export function useUpdateTask(taskId: string) {
  const update = useMutation(updateTaskAtom);
  return React.useCallback(
    (input: UpdateTaskInput, strategy: TaskCacheStrategy) =>
      update(taskId, input, strategy),
    [taskId, update],
  );
}

export function useDeleteTask() {
  return useMutation(deleteTaskAtom);
}

export function useAddTaskLabel(taskId: string) {
  const addLabel = useMutation(addTaskLabelAtom);
  return React.useCallback(
    (label: TeamLabel) => addLabel(taskId, label),
    [addLabel, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string) {
  const removeLabel = useMutation(removeTaskLabelAtom);
  return React.useCallback(
    (labelId: string) => removeLabel(taskId, labelId),
    [removeLabel, taskId],
  );
}

export function useCreateLabel() {
  return useMutation(createLabelAtom);
}

export function useCreateProject() {
  return useMutation(createProjectAtom);
}

/* ------------------------------- Refresh ------------------------------- */

/**
 * Manual workspace refresh. The invalidation is a single atom write, and the
 * list transition is what keeps the current data on screen while the new reads
 * resolve.
 *
 * The button's own spinner needs one thing the transition cannot tell it. A
 * filter change and an edit land in the same transition, so `isPending` answers
 * "is the list being replaced", not "is a refresh running" — and a refresh icon
 * spinning every time a title is saved would be claiming something that never
 * happened. Tracking whether this hook is what started the pending transition
 * is the difference between the two questions.
 */
export function useWorkspaceRefresh() {
  const refreshWorkspace = useSetAtom(refreshWorkspaceAtom);
  const { isPending, startTransition } = useWorkspaceTransition();
  const [isRequested, setIsRequested] = React.useState(false);

  const refresh = React.useCallback(() => {
    setIsRequested(true);
    startTransition(() => {
      refreshWorkspace();
    });
  }, [refreshWorkspace, startTransition]);

  React.useEffect(() => {
    if (isRequested && !isPending) {
      setIsRequested(false);
    }
  }, [isPending, isRequested]);

  return { refresh, isRefreshing: isRequested && isPending };
}

/**
 * `refresh(someAtom)` — the retry control behind every error boundary. It goes
 * through the store rather than `useSetAtom` so one callback can refresh any
 * query atom, including the members of an atom family.
 */
export function useRefreshQuery() {
  const store = useStore();

  return React.useCallback(
    <Value,>(query: QueryAtom<Value>) => {
      store.set(query, { type: "refresh" });
    },
    [store],
  );
}

/** Retry for the detail panel, which knows the open task only as a selection. */
export function useRefreshSelectedTask() {
  const store = useStore();

  return React.useCallback(() => {
    const taskId = store.get(selectedTaskIdAtom);
    if (taskId === null) {
      return;
    }

    store.set(
      taskAtomFamily({ teamId: store.get(activeTeamIdAtom), taskId }),
      { type: "refresh" },
    );
  }, [store]);
}

/** Retry for the dependency status, which owns both of a task's edge reads. */
export function useRefreshTaskDependencies(taskId: string) {
  const key = useTaskKey(taskId);
  const refreshQuery = useRefreshQuery();

  return React.useCallback(() => {
    refreshQuery(blockedByAtomFamily(key));
    refreshQuery(blockingAtomFamily(key));
  }, [key, refreshQuery]);
}
