"use client";

import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Task,
  TeamLabel,
  UpdateTaskInput,
} from "@/server/api";
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
import { TEAM_SCOPED_KEYS, workspaceReads } from "./lane-reads";
import {
  insertTaskIntoMatchingList,
  replaceTaskInList,
  type TaskCacheStrategy,
  taskCacheStrategies,
  taskFiltersFromEntry,
} from "./task-cache-sync";

/* -------------------------------- Reads -------------------------------- */

/**
 * The reads pass straight through. The session the loaders need comes from the
 * lane (`ClientWorkspaceProvider` supplies it as `loaderMeta`), so there is
 * nothing to bind here and nothing to memoize — a read is a plain object built
 * per render.
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

/* --------------------------- Dependency reads -------------------------- */

/**
 * The two reads behind the detail panel's dependency status. Both are gated —
 * a task with no blockers (or that blocks nothing) never fetches, and the
 * reader unwraps `promise` conditionally (see `lane-reads.ts`). They feed one
 * combined verdict, which is why each stays an independent gated read rather
 * than a conditional mount or a single merged loader.
 */
export function useBlockedByTasks(taskId: string, ids: string[]) {
  return useLane(workspaceReads.blockedBy(taskId, ids));
}

export function useBlockingTasks(taskId: string, ids: string[]) {
  return useLane(workspaceReads.blocking(taskId, ids));
}

/* ------------------------------ Mutations ------------------------------ */

export function useCreateTask() {
  const ctx = useWorkspaceCtx();
  const lane = useLaneInstance();

  return React.useCallback(async (input: CreateTaskInput): Promise<Task> => {
    const task = await createTask(ctx, input);
    // The key carries what its entry holds, so the publication is checked
    // against `Task` — and needs nothing but the key.
    lane.set(workspaceReads.task(task.id).key, task);
    lane.updateAll<Task[]>(["tasks"], (tasks, entry) => {
      const filters = taskFiltersFromEntry(entry);
      return filters
        ? insertTaskIntoMatchingList(tasks, task, filters, ctx.userId)
        : tasks;
    });
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

  return React.useCallback(async (task: Task): Promise<void> => {
    await deleteTask(ctx, task.id);
    lane.remove(workspaceReads.task(task.id).key);
    removeTaskFromTaskLists(lane, task.id);
    scheduleDerivedWorkspaceRefresh(lane, {
      insights: true,
      projects: true,
    });
    invalidateDependencyEntries(lane, task);
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
    lane.invalidate(workspaceReads.labels().key);
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
    lane.invalidate(workspaceReads.projects().key);
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
      lane.invalidate(workspaceReads.insights().key);
      lane.invalidate(workspaceReads.projects().key);
      lane.invalidate(workspaceReads.labels().key);
      lane.invalidate(workspaceReads.members().key);
    });
  }, [lane]);

  return { refresh, isRefreshing };
}

function publishTask(
  lane: Lane,
  task: Task,
  strategy: TaskCacheStrategy,
) {
  lane.set(workspaceReads.task(task.id).key, task);
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
  if (strategy.refreshDependencies) {
    invalidateDependencyEntries(lane, task);
  }
}

// Dependency reads cache copies of related tasks. The returned task tells us
// exactly which owners contain that copy, so unrelated dependency panels stay
// settled.
function invalidateDependencyEntries(lane: Lane, task: Task) {
  for (const ownerTaskId of task.blocks) {
    lane.invalidate(
      workspaceReads.blockedBy(ownerTaskId, [task.id]).key,
      { onlyIf: "settled" },
    );
  }

  for (const ownerTaskId of task.blockedBy) {
    lane.invalidate(
      workspaceReads.blocking(ownerTaskId, [task.id]).key,
      { onlyIf: "settled" },
    );
  }
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

  const options = { background: true, onlyIf: "settled" } as const;
  if (refresh.insights) {
    lane.invalidate(workspaceReads.insights().key, options);
  }

  if (refresh.projects) {
    lane.invalidate(workspaceReads.projects().key, options);
  }
}

export function clearTeamScopedLaneEntries(
  lane: Lane,
) {
  for (const key of TEAM_SCOPED_KEYS) {
    lane.removeAll(key);
  }
}
