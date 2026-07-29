"use client";

import { laneRead } from "use-lane";
import type { WorkspaceCtx } from "./client";
import {
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasks,
  fetchTeams,
  type TaskFilters,
} from "./endpoints";
import { queryKeys } from "./query-options";

/**
 * Every read the workspace performs, defined once — `laneRead` colocates a
 * read's key, its loader, and the options it is read with, the way
 * react-query's `queryOptions()` does.
 *
 * Sharing only the *key* (see `query-options.ts`) shares half a read: the
 * loader and the freshness options would still be written at each call site,
 * where nothing checks that they belong to that key. Here `useTasks` cannot
 * accidentally read `["tasks", filters]` with a one-second `staleTime` while
 * some other component reads it with none.
 *
 * They take the workspace context because the **loader** needs it. The key half
 * is context-free, which is why `queryKeys` stays: the RSC seeding path (a
 * server component, where a `"use client"` module's exports are references it
 * cannot call) and the invalidations fired from components that hold no context
 * need a key and nothing more.
 */
export const laneReads = {
  currentUser: (ctx: WorkspaceCtx) =>
    laneRead({
      key: queryKeys.currentUser,
      loader: () => fetchCurrentUser(ctx),
    }),
  teams: (ctx: WorkspaceCtx) =>
    laneRead({ key: queryKeys.teams, loader: () => fetchTeams(ctx) }),
  tasks: (ctx: WorkspaceCtx, filters: TaskFilters) =>
    laneRead({
      key: queryKeys.tasks(filters),
      loader: () => fetchTasks(ctx, filters),
      refetchOnFocus: true,
      refetchOnMount: true,
      staleTime: 1_000,
    }),
  task: (ctx: WorkspaceCtx, taskId: string) =>
    laneRead({
      key: queryKeys.task(taskId),
      loader: () => fetchTask(ctx, taskId),
    }),
  projects: (ctx: WorkspaceCtx) =>
    laneRead({ key: queryKeys.projects, loader: () => fetchProjects(ctx) }),
  labels: (ctx: WorkspaceCtx) =>
    laneRead({ key: queryKeys.labels, loader: () => fetchLabels(ctx) }),
  members: (ctx: WorkspaceCtx) =>
    laneRead({ key: queryKeys.members, loader: () => fetchMembers(ctx) }),
  insights: (ctx: WorkspaceCtx) =>
    laneRead({ key: queryKeys.insights, loader: () => fetchInsights(ctx) }),
};
