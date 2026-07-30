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
import { entryKeys } from "./keys";

/**
 * The same keys as `keys.ts`, carrying what each entry holds.
 *
 * This layer exists because of one constraint, not by preference: `laneKey` is a
 * runtime export of a `"use client"` package, so it cannot be called in the
 * server-safe module the RSC seed path imports (see `keys.ts`). The literals stay
 * there; the types are attached here, which is what makes a write checked —
 * `lane.set` cannot put a `Project` under a task key.
 *
 * It deliberately holds **no loaders**, because addressing an entry never needs
 * one. That is what lets `publishTask` (in `hooks.ts`) take no request context at
 * all.
 */
export const laneKeys = {
  currentUser: () => laneKey<CurrentUser>(entryKeys.currentUser),
  teams: () => laneKey<TeamSummary[]>(entryKeys.teams),
  tasks: (filters: TaskFilters) => laneKey<Task[]>(entryKeys.tasks(filters)),
  task: (taskId: string) => laneKey<Task>(entryKeys.task(taskId)),
  projects: () => laneKey<Project[]>(entryKeys.projects),
  labels: () => laneKey<TeamLabel[]>(entryKeys.labels),
  members: () => laneKey<TeamMember[]>(entryKeys.members),
  insights: () => laneKey<Insights>(entryKeys.insights),
};

/**
 * Every read the workspace performs, defined once — `laneRead` colocates a
 * read's key, its loader, and the options it is read with, the way
 * react-query's `queryOptions()` does.
 *
 * Sharing only the *key* shares half a read: the
 * loader and the freshness options would still be written at each call site,
 * where nothing checks that they belong to that key. Here `useTasks` cannot
 * accidentally read `["tasks", filters]` with a one-second `staleTime` while
 * some other component reads it with none.
 *
 * The workspace context is bound **once, here**, rather than passed to every
 * factory. What a loader needs to run and what makes a read distinct are
 * different things: `ctx` travels in request headers and is deliberately not in
 * any key, so a `tasks(ctx, filters)` signature would list two arguments of
 * which only one decides which entry is read. Binding the dependency up front
 * leaves each factory taking exactly its identity — `tasks(filters)`,
 * `task(taskId)` — which is also what the keys in `laneKeys` take.
 *
 * The reads are built on those keys, so one array literal per entry serves both
 * the read and the writes to it.
 */
export function workspaceReads(ctx: WorkspaceCtx) {
  return {
    currentUser: () =>
      laneRead({
        key: laneKeys.currentUser(),
        loader: () => fetchCurrentUser(ctx),
      }),
    teams: () =>
      laneRead({ key: laneKeys.teams(), loader: () => fetchTeams(ctx) }),
    tasks: (filters: TaskFilters) =>
      laneRead({
        key: laneKeys.tasks(filters),
        loader: () => fetchTasks(ctx, filters),
        refetchOnFocus: true,
        refetchOnMount: true,
        staleTime: 1_000,
      }),
    task: (taskId: string) =>
      laneRead({
        key: laneKeys.task(taskId),
        loader: () => fetchTask(ctx, taskId),
      }),
    projects: () =>
      laneRead({ key: laneKeys.projects(), loader: () => fetchProjects(ctx) }),
    labels: () =>
      laneRead({ key: laneKeys.labels(), loader: () => fetchLabels(ctx) }),
    members: () =>
      laneRead({ key: laneKeys.members(), loader: () => fetchMembers(ctx) }),
    insights: () =>
      laneRead({ key: laneKeys.insights(), loader: () => fetchInsights(ctx) }),
  };
}
