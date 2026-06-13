"use client";

import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Task,
  TeamLabel,
  UpdateTaskInput,
} from "@lane/todo-api";
import { useLane, useLaneInstance, type Lane } from "use-lane";
import * as React from "react";
import { useWorkspaceCtx } from "@/app/lane-spa/workspace/workspace-provider";
import {
  addTaskLabel,
  createLabel,
  createProject,
  createTask,
  deleteTask,
  removeTaskLabel,
  updateTask,
} from "./endpoints";
import type { TaskFilters } from "./endpoints";
import {
  queryKeys,
  TEAM_SCOPED_KEYS,
} from "./query-options";
import {
  replaceTaskInList,
  type TaskCacheStrategy,
  taskCacheStrategies,
  taskFiltersFromEntry,
} from "./task-cache-sync";
import {
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasks,
  fetchTeams,
} from "./endpoints";

/* -------------------------------- Reads -------------------------------- */

export function useCurrentUser() {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.currentUser, () => fetchCurrentUser(ctx));
}

export function useTeams() {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.teams, () => fetchTeams(ctx));
}

export function useTasks(filters: TaskFilters) {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.tasks(filters), () => fetchTasks(ctx, filters), {
    refetchOnFocus: true,
    refetchOnMount: true,
    staleTime: 1_000,
  });
}

export function useTask(taskId: string) {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.task(taskId), () => fetchTask(ctx, taskId));
}

export function useProjects() {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.projects, () => fetchProjects(ctx));
}

export function useLabels() {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.labels, () => fetchLabels(ctx));
}

export function useMembers() {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.members, () => fetchMembers(ctx));
}

export function useInsights() {
  const ctx = useWorkspaceCtx();
  return useLane(queryKeys.insights, () => fetchInsights(ctx));
}

/* ------------------------------ Mutations ------------------------------ */

export function useCreateTask() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (input: CreateTaskInput): Promise<Task> => {
    const task = await createTask(ctx, input);
    lane.set(queryKeys.task(task.id), task);
    lane.invalidateAll(["tasks"]);
    scheduleDerivedWorkspaceRefresh(lane, {
      insights: true,
      projects: Boolean(task.project),
    });
    return task;
  }, [ctx, lane]);
}

export function useUpdateTask(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (
    input: UpdateTaskInput,
    strategy: TaskCacheStrategy,
  ): Promise<Task> => {
    const task = await updateTask(ctx, taskId, input);
    publishTask(lane, task, strategy);
    return task;
  }, [ctx, lane, taskId]);
}

export function useDeleteTask() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (taskId: string): Promise<void> => {
    await deleteTask(ctx, taskId);
    lane.remove(queryKeys.task(taskId));
    removeTaskFromTaskLists(lane, taskId);
    scheduleDerivedWorkspaceRefresh(lane, {
      insights: true,
      projects: true,
    });
  }, [ctx, lane]);
}

export function useAddTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (label: TeamLabel): Promise<Task> => {
    const task = await addTaskLabel(ctx, taskId, label.id);
    publishTask(lane, task, taskCacheStrategies.labels);
    return task;
  }, [ctx, lane, taskId]);
}

export function useRemoveTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (labelId: string): Promise<Task> => {
    const task = await removeTaskLabel(ctx, taskId, labelId);
    publishTask(lane, task, taskCacheStrategies.labels);
    return task;
  }, [ctx, lane, taskId]);
}

export function useCreateLabel() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (
    input: CreateLabelInput,
  ): Promise<TeamLabel> => {
    const label = await createLabel(ctx, input);
    lane.invalidate(queryKeys.labels);
    return label;
  }, [ctx, lane]);
}

export function useCreateProject() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (
    input: CreateProjectInput,
  ) => {
    const project = await createProject(ctx, input);
    lane.invalidate(queryKeys.projects);
    return project;
  }, [ctx, lane]);
}

/* ------------------------------- Refresh ------------------------------- */

export function useWorkspaceRefresh() {
  const lane = useLaneInstance();
  const [isRefreshing, startRefresh] = React.useTransition();

  const refresh = React.useCallback(() => {
    startRefresh(() => {
      lane.invalidateAll(["tasks"]);
      lane.invalidate(queryKeys.insights);
      lane.invalidate(queryKeys.projects);
      lane.invalidate(queryKeys.labels);
      lane.invalidate(queryKeys.members);
    });
  }, [lane]);

  return { refresh, isRefreshing };
}

function publishTask(
  lane: Lane,
  task: Task,
  strategy: TaskCacheStrategy,
) {
  lane.set(queryKeys.task(task.id), task);
  lane.updateAll<Task[]>(
    (entry) => {
      const filters = taskFiltersFromEntry(entry);
      return Boolean(filters && !strategy.shouldInvalidateTaskList(filters));
    },
    (tasks) => replaceTaskInList(tasks, task),
  );
  lane.invalidateAll((entry) => {
    const filters = taskFiltersFromEntry(entry);
    return Boolean(filters && strategy.shouldInvalidateTaskList(filters));
  });
  scheduleDerivedWorkspaceRefresh(lane, {
    insights: strategy.refreshInsights,
    projects: strategy.refreshProjects,
  });
}

function removeTaskFromTaskLists(
  lane: Lane,
  taskId: string,
) {
  lane.updateAll<Task[]>(["tasks"], (tasks) =>
    tasks.filter((item) => item.id !== taskId),
  );
}

function scheduleDerivedWorkspaceRefresh(
  lane: Lane,
  refresh: { insights: boolean; projects: boolean },
) {
  if (!refresh.insights && !refresh.projects) {
    return;
  }

  React.startTransition(() => {
    if (refresh.insights) {
      lane.invalidate(queryKeys.insights);
    }

    if (refresh.projects) {
      lane.invalidate(queryKeys.projects);
    }
  });
}

export function clearTeamScopedLaneEntries(
  lane: Lane,
) {
  for (const key of TEAM_SCOPED_KEYS) {
    lane.removeAll(key);
  }
}
