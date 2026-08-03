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
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";
import { useWorkspaceCtx } from "@/app/react-query/workspace/workspace-provider";
import {
  addTaskLabelAction,
  createLabelAction,
  createProjectAction,
  createTaskAction,
  deleteTaskAction,
  refreshWorkspaceAction,
  removeTaskLabelAction,
  updateTaskAction,
} from "./actions";
import type { TaskFilters } from "./endpoints";
import {
  blockedByTasksQueryOptions,
  blockingTasksQueryOptions,
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

/* --------------------------- Dependency reads -------------------------- */

/**
 * The two reads behind the detail panel's dependency status. Each is gated with
 * `enabled` so it only runs when the task actually has that edge, and both feed a
 * single combined verdict in the component — the case where `enabled` earns its
 * keep (you cannot split the verdict across separately-mounted children).
 */
export function useBlockedByTasks(taskId: string, ids: string[]) {
  const ctx = useWorkspaceCtx();
  return useQuery({
    ...blockedByTasksQueryOptions(ctx, taskId, ids),
    enabled: ids.length > 0,
  });
}

export function useBlockingTasks(taskId: string, ids: string[]) {
  const ctx = useWorkspaceCtx();
  return useQuery({
    ...blockingTasksQueryOptions(ctx, taskId, ids),
    enabled: ids.length > 0,
  });
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

function removeTaskFromTaskLists(queryClient: QueryClient, taskId: string) {
  queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (list) =>
    list?.filter((task) => task.id !== taskId),
  );
}

/* ------------------------------ Mutations ------------------------------ */

/**
 * Next recognizes an imported Server Function as an action when it is invoked
 * in a transition. TanStack starts `mutationFn` after `onMutate` resolves, so
 * establish the action transition here instead of relying on the event that
 * originally called `mutate`.
 */
function invokeAction<T>(action: () => Promise<T>): Promise<T> {
  let result!: Promise<T>;
  React.startTransition(() => {
    result = action();
  });
  return result;
}

export function useCreateTask() {
  const ctx = useWorkspaceCtx();

  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      invokeAction(() => createTaskAction(ctx, input)),
  });
}

export function useUpdateTask(taskId: string) {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input }: UpdateTaskMutation) =>
      invokeAction(() => updateTaskAction(ctx, taskId, input)),
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
    // Do not publish the returned Task or invalidate queries here. The action's
    // same-response RSC render has a later `dataUpdatedAt` than this optimistic
    // write; HydrationBoundary applies that server generation after commit.
  });
}

export function useDeleteTask() {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) =>
      invokeAction(() => deleteTaskAction(ctx, taskId)),
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
      // A deleted selected task is intentionally omitted from dehydration: a
      // missing query cannot replace an existing one. This is the one narrow
      // client cleanup needed before the caller removes `task` from the URL.
      queryClient.removeQueries({ queryKey: queryKeys.task(taskId) });
    },
  });
}

export function useAddTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (label: TeamLabel) =>
      invokeAction(() => addTaskLabelAction(ctx, taskId, label.id)),
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
  });
}

export function useRemoveTaskLabel(taskId: string) {
  const ctx = useWorkspaceCtx();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) =>
      invokeAction(() => removeTaskLabelAction(ctx, taskId, labelId)),
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
  });
}

export function useCreateLabel() {
  const ctx = useWorkspaceCtx();

  return useMutation({
    mutationFn: (input: CreateLabelInput) =>
      invokeAction(() => createLabelAction(ctx, input)),
  });
}

export function useCreateProject() {
  const ctx = useWorkspaceCtx();

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      invokeAction(() => createProjectAction(ctx, input)),
  });
}

/* ------------------------------- Refresh ------------------------------- */

/**
 * Manual workspace refresh asks Next to replace every server cache domain and
 * returns the resulting dehydrated generation in the action response. Browser
 * query fetching is deliberately not part of this path.
 */
export function useWorkspaceRefresh() {
  const ctx = useWorkspaceCtx();
  const { mutate, isPending } = useMutation({
    mutationFn: () => invokeAction(() => refreshWorkspaceAction(ctx)),
  });
  const refresh = React.useCallback(() => mutate(), [mutate]);

  return { refresh, isRefreshing: isPending };
}
