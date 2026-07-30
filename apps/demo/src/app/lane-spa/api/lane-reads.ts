"use client";

import { laneRead } from "use-lane";
import {
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasks,
  fetchTasksByIds,
  fetchTeams,
  type TaskFilters,
} from "./endpoints";

/**
 * Every read this workspace performs, defined once — key, loader, and freshness
 * in one place, which is all `laneRead` has ever been for.
 *
 * What is worth noticing is what is **not** here: a second map of keys. Each
 * factory takes exactly what decides its key, and the session the loaders need
 * arrives from the lane as `meta` (declared in `@/lib/lane-meta`, supplied by
 * `ClientWorkspaceProvider`). So a read is a plain object that costs nothing to
 * build, and `.key` is reachable from anywhere — a mutation, an error-boundary
 * retry, a component above the provider:
 *
 * ```ts
 * lane.set(workspaceReads.task(task.id).key, task);
 * lane.invalidate(workspaceReads.insights().key);
 * ```
 *
 * Binding the session into the factories instead — `workspaceReads(ctx).task(id)`
 * — is what used to force a parallel `laneKeys` map: the write side would have
 * had to produce a request context just to *name* an entry. Those keys are now
 * the reads' own, so the loaded type is inferred from the fetcher rather than
 * restated by hand, and there is one definition to keep correct instead of two.
 *
 * Team-owned keys omit `teamId`: the active team travels in request headers, and
 * the workspace removes these keys when it changes (see `TEAM_SCOPED_KEYS`).
 * That is the standing obligation of a session that lives on the lane rather
 * than in the key — nothing invalidates on its own when the meta changes.
 */
export const workspaceReads = {
  currentUser: () =>
    laneRead({
      key: ["current-user"],
      loader: ({ meta }) => fetchCurrentUser(meta),
    }),
  teams: () =>
    laneRead({ key: ["teams"], loader: ({ meta }) => fetchTeams(meta) }),
  tasks: (filters: TaskFilters) =>
    laneRead({
      key: ["tasks", filters],
      loader: ({ meta }) => fetchTasks(meta, filters),
      refetchOnFocus: true,
      refetchOnMount: true,
      staleTime: 1_000,
    }),
  task: (taskId: string) =>
    laneRead({
      key: ["task", taskId],
      loader: ({ meta }) => fetchTask(meta, taskId),
    }),
  projects: () =>
    laneRead({ key: ["projects"], loader: ({ meta }) => fetchProjects(meta) }),
  labels: () =>
    laneRead({ key: ["labels"], loader: ({ meta }) => fetchLabels(meta) }),
  members: () =>
    laneRead({ key: ["members"], loader: ({ meta }) => fetchMembers(meta) }),
  insights: () =>
    laneRead({ key: ["insights"], loader: ({ meta }) => fetchInsights(meta) }),

  /**
   * The detail panel's two dependency reads. Gating lives *in the definition*: a
   * task with no blockers (or that blocks nothing) has no loader, so nothing is
   * fetched, subscribed, or stored, and the reader unwraps `promise`
   * conditionally. The loaded type is unaffected — the off-state is on the
   * `promise: undefined` axis — and `.key` is tagged either way, so an
   * error-boundary retry can invalidate a read that is currently gated off.
   *
   * `ids` is the one parameter here that does not reach the key: the entry is
   * "this task's blockers", and which ids that means is the task's own business.
   * A caller that only wants the key passes them anyway, which is honest about
   * the loader it is naming — and every such caller has the task in hand.
   */
  blockedBy: (taskId: string, ids: string[]) =>
    laneRead({
      key: ["task-blocked-by", taskId],
      loader:
        ids.length > 0 ? ({ meta }) => fetchTasksByIds(meta, ids) : undefined,
      refetchOnMount: true,
      staleTime: 5_000,
    }),
  blocking: (taskId: string, ids: string[]) =>
    laneRead({
      key: ["task-blocking", taskId],
      loader:
        ids.length > 0 ? ({ meta }) => fetchTasksByIds(meta, ids) : undefined,
      refetchOnMount: true,
      staleTime: 5_000,
    }),
};

/**
 * The key families that belong to the active team and are removed when it
 * changes. Prefix *scopes*, not keys — they name a family of entries rather than
 * one, so they carry no type and belong to no single read.
 */
export const TEAM_SCOPED_KEYS = [
  ["tasks"],
  ["task"],
  ["projects"],
  ["labels"],
  ["members"],
  ["insights"],
] as const;
