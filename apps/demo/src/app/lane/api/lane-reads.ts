"use client";

import { laneKey, laneRead } from "use-lane";
import type { WorkspaceCtx } from "./client";
import type {
  CurrentUser,
  Insights,
  Project,
  Task,
  TeamLabel,
  TeamMember,
  TeamSummary,
} from "@/server/api";
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
 * The keys the workspace writes to, carrying what each entry holds.
 *
 * `queryKeys` (in `query-options.ts`) stays as it is: plain arrays, importable
 * from the server for RSC seeding and usable as prefix scopes. This layer adds
 * the types, so a publication is checked — `lane.set` here cannot put a
 * `Project` under a task key — and it deliberately holds **no loaders**, because
 * addressing an entry never needs one. That is what lets `publishTask` below
 * take no request context at all.
 */
export const laneKeys = {
  currentUser: () => laneKey<CurrentUser>(queryKeys.currentUser),
  teams: () => laneKey<TeamSummary[]>(queryKeys.teams),
  tasks: (filters: TaskFilters) => laneKey<Task[]>(queryKeys.tasks(filters)),
  task: (taskId: string) => laneKey<Task>(queryKeys.task(taskId)),
  projects: () => laneKey<Project[]>(queryKeys.projects),
  labels: () => laneKey<TeamLabel[]>(queryKeys.labels),
  members: () => laneKey<TeamMember[]>(queryKeys.members),
  insights: () => laneKey<Insights>(queryKeys.insights),
};

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
 * They take the workspace context because the **loader** needs it, and they are
 * built on `laneKeys` below, so a read and the key it writes to are checked
 * against each other: a loader returning the wrong shape for its key does not
 * compile.
 */
export const laneReads = {
  currentUser: (ctx: WorkspaceCtx) =>
    laneRead({
      key: laneKeys.currentUser(),
      loader: () => fetchCurrentUser(ctx),
    }),
  teams: (ctx: WorkspaceCtx) =>
    laneRead({ key: laneKeys.teams(), loader: () => fetchTeams(ctx) }),
  tasks: (ctx: WorkspaceCtx, filters: TaskFilters) =>
    laneRead({
      key: laneKeys.tasks(filters),
      loader: () => fetchTasks(ctx, filters),
      refetchOnFocus: true,
      refetchOnMount: true,
      staleTime: 1_000,
    }),
  task: (ctx: WorkspaceCtx, taskId: string) =>
    laneRead({
      key: laneKeys.task(taskId),
      loader: () => fetchTask(ctx, taskId),
    }),
  projects: (ctx: WorkspaceCtx) =>
    laneRead({ key: laneKeys.projects(), loader: () => fetchProjects(ctx) }),
  labels: (ctx: WorkspaceCtx) =>
    laneRead({ key: laneKeys.labels(), loader: () => fetchLabels(ctx) }),
  members: (ctx: WorkspaceCtx) =>
    laneRead({ key: laneKeys.members(), loader: () => fetchMembers(ctx) }),
  insights: (ctx: WorkspaceCtx) =>
    laneRead({ key: laneKeys.insights(), loader: () => fetchInsights(ctx) }),
};
