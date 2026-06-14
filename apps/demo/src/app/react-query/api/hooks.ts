"use client";

import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  TeamLabel,
  TeamMember,
  UpdateTaskInput,
} from "@/server/api";
import {
  type QueryClient,
  keepPreviousData,
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";
import { useWorkspaceCtx } from "@/app/react-query/workspace/workspace-provider";
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
  currentUserQueryOptions,
  insightsQueryOptions,
  labelsQueryOptions,
  membersQueryOptions,
  projectsQueryOptions,
  queryKeys,
  taskQueryOptions,
  tasksQueryOptions,
  teamsQueryOptions,
} from "./query-options";
import {
  replaceTaskInList,
  type TaskCacheStrategy,
  taskCacheStrategies,
  taskFiltersFromQueryKey,
} from "./task-cache-sync";

/* -------------------------------- Reads -------------------------------- */

export function useCurrentUser() {
  return useQuery(currentUserQueryOptions(useWorkspaceCtx()));
}

export function useTeams() {
  return useQuery(teamsQueryOptions(useWorkspaceCtx()));
}

export function useTasks(filters: TaskFilters) {
  return useQuery({
    ...tasksQueryOptions(useWorkspaceCtx(), filters),
    // Keep the previous list on screen while a filtered/refreshed result loads.
    placeholderData: keepPreviousData,
  });
}

export function useTask(taskId: string | null) {
  const ctx = useWorkspaceCtx();
  return useQuery({
    ...taskQueryOptions(ctx, taskId ?? "__none__"),
    enabled: Boolean(taskId),
  });
}

export function useProjects() {
  return useQuery(projectsQueryOptions(useWorkspaceCtx()));
}

export function useLabels() {
  return useQuery(labelsQueryOptions(useWorkspaceCtx()));
}

export function useMembers() {
  return useQuery(membersQueryOptions(useWorkspaceCtx()));
}

export function useInsights() {
  return useQuery(insightsQueryOptions(useWorkspaceCtx()));
}

/* -------------------------- Optimistic helpers ------------------------- */

function patchTask(
  task: Task,
  input: UpdateTaskInput,
  queryClient: QueryClient,
): Task {
  const next: Task = { ...task };

  if (input.title !== undefined) next.title = input.title;
  if (input.description !== undefined) next.description = input.description;
  if (input.status !== undefined) next.status = input.status;
  if (input.priority !== undefined) next.priority = input.priority;
  if (input.dueDate !== undefined) next.dueDate = input.dueDate;

  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) {
      next.assignee = null;
    } else {
      const members =
        queryClient.getQueryData<TeamMember[]>(queryKeys.members) ?? [];
      next.assignee =
        members.find((member) => member.id === input.assigneeId) ??
        task.assignee;
    }
  }

  if (input.projectId !== undefined) {
    if (input.projectId === null) {
      next.project = null;
    } else {
      const projects =
        queryClient.getQueryData<Project[]>(queryKeys.projects) ?? [];
      next.project =
        projects.find((project) => project.id === input.projectId) ??
        task.project;
    }
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

type TaskSnapshot = {
  lists: [readonly unknown[], Task[] | undefined][];
  detail: Task | undefined;
};

type UpdateTaskMutation = {
  input: UpdateTaskInput;
  strategy: TaskCacheStrategy;
};

function snapshotTask(
  queryClient: QueryClient,
  taskId: string,
): TaskSnapshot {
  return {
    lists: queryClient.getQueriesData<Task[]>({ queryKey: ["tasks"] }),
    detail: queryClient.getQueryData<Task>(queryKeys.task(taskId)),
  };
}

function applyTaskUpdate(
  queryClient: QueryClient,
  taskId: string,
  update: (task: Task) => Task,
  strategy: TaskCacheStrategy,
) {
  for (const [key, list] of queryClient.getQueriesData<Task[]>({
    queryKey: ["tasks"],
  })) {
    const filters = taskFiltersFromQueryKey(key);
    if (!list || !filters || strategy.shouldInvalidateTaskList(filters)) {
      continue;
    }

    queryClient.setQueryData(
      key,
      list.map((task) => (task.id === taskId ? update(task) : task)),
    );
  }

  const detail = queryClient.getQueryData<Task>(queryKeys.task(taskId));
  if (detail) {
    queryClient.setQueryData(queryKeys.task(taskId), update(detail));
  }
}

function restoreTask(
  queryClient: QueryClient,
  taskId: string,
  snapshot: TaskSnapshot | undefined,
) {
  if (!snapshot) return;
  for (const [key, data] of snapshot.lists) {
    queryClient.setQueryData(key, data);
  }
  queryClient.setQueryData(queryKeys.task(taskId), snapshot.detail);
}

function publishTask(
  queryClient: QueryClient,
  task: Task,
  strategy: TaskCacheStrategy,
) {
  queryClient.setQueryData(queryKeys.task(task.id), task);

  for (const [key, list] of queryClient.getQueriesData<Task[]>({
    queryKey: ["tasks"],
  })) {
    const filters = taskFiltersFromQueryKey(key);
    if (!list || !filters || strategy.shouldInvalidateTaskList(filters)) {
      continue;
    }

    queryClient.setQueryData(key, replaceTaskInList(list, task));
  }
}

function invalidateAllTaskLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

function invalidateTaskLists(
  queryClient: QueryClient,
  strategy: TaskCacheStrategy,
) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const filters = taskFiltersFromQueryKey(query.queryKey);
      return Boolean(filters && strategy.shouldInvalidateTaskList(filters));
    },
  });
}

function invalidateDerivedTaskViews(
  queryClient: QueryClient,
  refresh: { insights: boolean; projects: boolean },
) {
  if (refresh.insights) {
    queryClient.invalidateQueries({ queryKey: queryKeys.insights });
  }

  if (refresh.projects) {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  }
}

function invalidateTaskViews(
  queryClient: QueryClient,
  strategy: TaskCacheStrategy,
) {
  invalidateTaskLists(queryClient, strategy);
  invalidateDerivedTaskViews(queryClient, {
    insights: strategy.refreshInsights,
    projects: strategy.refreshProjects,
  });
}

function removeTaskFromTaskLists(queryClient: QueryClient, taskId: string) {
  queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (list) =>
    list?.filter((task) => task.id !== taskId),
  );
}

function invalidateWorkspaceTaskViews(queryClient: QueryClient) {
  invalidateAllTaskLists(queryClient);
  queryClient.invalidateQueries({ queryKey: queryKeys.insights });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects });
}

/* ------------------------------ Mutations ------------------------------ */

export function useCreateTask() {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskInput) => createTask(ctx, input),
    onSuccess: (task) => {
      queryClient.setQueryData(queryKeys.task(task.id), task);
      invalidateAllTaskLists(queryClient);
      invalidateDerivedTaskViews(queryClient, {
        insights: true,
        projects: Boolean(task.project),
      });
    },
  });
}

export function useUpdateTask(taskId: string) {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input }: UpdateTaskMutation) =>
      updateTask(ctx, taskId, input),
    onMutate: async ({ input, strategy }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      const snapshot = snapshotTask(queryClient, taskId);
      applyTaskUpdate(queryClient, taskId, (task) =>
        patchTask(task, input, queryClient),
        strategy,
      );
      return snapshot;
    },
    onError: (_error, _variables, snapshot) =>
      restoreTask(queryClient, taskId, snapshot),
    onSuccess: (task, { strategy }) => publishTask(queryClient, task, strategy),
    onSettled: (_task, _error, { strategy }) =>
      invalidateTaskViews(queryClient, strategy),
  });
}

export function useDeleteTask() {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => deleteTask(ctx, taskId),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      const snapshot = snapshotTask(queryClient, taskId);
      removeTaskFromTaskLists(queryClient, taskId);
      return snapshot;
    },
    onError: (_error, taskId, snapshot) =>
      restoreTask(queryClient, taskId, snapshot),
    onSuccess: (_data, taskId) => {
      queryClient.removeQueries({ queryKey: queryKeys.task(taskId) });
      invalidateDerivedTaskViews(queryClient, {
        insights: true,
        projects: true,
      });
    },
  });
}

export function useAddTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (label: TeamLabel) => addTaskLabel(ctx, taskId, label.id),
    onMutate: async (label) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      const snapshot = snapshotTask(queryClient, taskId);
      applyTaskUpdate(queryClient, taskId, (task) =>
        task.labels.some((existing) => existing.id === label.id)
          ? task
          : {
              ...task,
              labels: [...task.labels, label].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            },
        taskCacheStrategies.labels,
      );
      return snapshot;
    },
    onError: (_error, _label, snapshot) =>
      restoreTask(queryClient, taskId, snapshot),
    onSuccess: (task) =>
      publishTask(queryClient, task, taskCacheStrategies.labels),
    onSettled: () => invalidateTaskViews(queryClient, taskCacheStrategies.labels),
  });
}

export function useRemoveTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) => removeTaskLabel(ctx, taskId, labelId),
    onMutate: async (labelId) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      const snapshot = snapshotTask(queryClient, taskId);
      applyTaskUpdate(
        queryClient,
        taskId,
        (task) => ({
          ...task,
          labels: task.labels.filter((label) => label.id !== labelId),
        }),
        taskCacheStrategies.labels,
      );
      return snapshot;
    },
    onError: (_error, _labelId, snapshot) =>
      restoreTask(queryClient, taskId, snapshot),
    onSuccess: (task) =>
      publishTask(queryClient, task, taskCacheStrategies.labels),
    onSettled: () => invalidateTaskViews(queryClient, taskCacheStrategies.labels),
  });
}

export function useCreateLabel() {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateLabelInput) => createLabel(ctx, input),
    onSuccess: () => {
      // Other label pickers should observe the new label after refresh.
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    },
  });
}

export function useCreateProject() {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(ctx, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

/* ------------------------------- Refresh ------------------------------- */

/**
 * Manual workspace refresh. Invalidates the live team queries and reports
 * whether anything is currently fetching, so the top bar can show a spinner
 * while keeping the existing data on screen.
 */
export function useWorkspaceRefresh() {
  const queryClient = useQueryClient();
  const fetchingCount = useIsFetching();

  const refresh = React.useCallback(() => {
    invalidateWorkspaceTaskViews(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    queryClient.invalidateQueries({ queryKey: queryKeys.members });
  }, [queryClient]);

  return { refresh, isRefreshing: fetchingCount > 0 };
}
