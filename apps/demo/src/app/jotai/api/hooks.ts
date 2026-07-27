"use client";

import type { TeamLabel, UpdateTaskInput } from "@/server/api";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import * as React from "react";
import {
  activeTeamIdAtom,
  addTaskLabelAtom,
  blockedByAtomFamily,
  blockingAtomFamily,
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
 * setter hands back the write function's promise, which is what lets these
 * stay plain async calls that a transition or `useActionState` can await.
 */
export function useCreateTask() {
  return useSetAtom(createTaskAtom);
}

export function useUpdateTask(taskId: string) {
  const update = useSetAtom(updateTaskAtom);
  return React.useCallback(
    (input: UpdateTaskInput, strategy: TaskCacheStrategy) =>
      update(taskId, input, strategy),
    [taskId, update],
  );
}

export function useDeleteTask() {
  return useSetAtom(deleteTaskAtom);
}

export function useAddTaskLabel(taskId: string) {
  const addLabel = useSetAtom(addTaskLabelAtom);
  return React.useCallback(
    (label: TeamLabel) => addLabel(taskId, label),
    [addLabel, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string) {
  const removeLabel = useSetAtom(removeTaskLabelAtom);
  return React.useCallback(
    (labelId: string) => removeLabel(taskId, labelId),
    [removeLabel, taskId],
  );
}

export function useCreateLabel() {
  return useSetAtom(createLabelAtom);
}

export function useCreateProject() {
  return useSetAtom(createProjectAtom);
}

/* ------------------------------- Refresh ------------------------------- */

/**
 * Manual workspace refresh. The invalidation is a single atom write; the
 * spinner comes from the shared transition, which is also what keeps the
 * current data on screen while the new reads resolve.
 */
export function useWorkspaceRefresh() {
  const refreshWorkspace = useSetAtom(refreshWorkspaceAtom);
  const { isPending, startTransition } = useWorkspaceTransition();

  const refresh = React.useCallback(() => {
    startTransition(() => {
      refreshWorkspace();
    });
  }, [refreshWorkspace, startTransition]);

  return { refresh, isRefreshing: isPending };
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
