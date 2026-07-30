import { laneRead, laneSnapshot } from "use-lane";
import type { LaneHydrationSnapshots, LaneSnapshot } from "use-lane";
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

/**
 * The board's own reads — the task list and the two views derived from it —
 * revalidate when the tab comes back to the foreground.
 *
 * They are the reads a teammate's edit invalidates, so coming back to a stale
 * board is the case worth handling; the catalogue reads around them (teams,
 * labels, members, the current user) only change when someone edits them and are
 * left to load once. `staleTime` is short enough that a refocus after a moment
 * away actually fetches, and long enough that flicking between two windows does
 * not.
 *
 * The react-query variant sets exactly this policy, on the same three reads, in
 * `react-query/api/query-options.ts`. Both libraries spell it the same way, and
 * keeping them matched is what makes the two variants comparable when you switch
 * away and come back — the notable part is not that they both refetch, it is how
 * many separate steps the screen takes to apply what comes back.
 */
const BOARD_REVALIDATION = {
  refetchOnFocus: true,
  refetchOnMount: true,
  staleTime: 1_000,
} as const;

/**
 * Every read this workspace performs, defined once — key, loader, and freshness
 * in one place, which is all `laneRead` has ever been for.
 *
 * What is worth noticing is what is **not** here: a second map of keys. Each
 * factory takes exactly what decides its key — `tasks(filters)`, `task(taskId)` —
 * and the session the loaders need arrives from the lane as `meta` (declared in
 * `@/lib/lane-meta`, supplied by `WorkspaceProvider`). So a read is a plain
 * object that costs nothing to build, and `.key` is reachable from anywhere:
 *
 * ```ts
 * lane.set(workspaceReads.task(task.id).key, task);   // a mutation, no session
 * laneSnapshot(workspaceReads.insights(), insights);  // a Server Component
 * ```
 *
 * Binding the session into the factories instead — `workspaceReads(ctx).task(id)`
 * — is what used to force a parallel `laneKeys` map: the write side and the RSC
 * seed would have had to produce a request context just to *name* an entry.
 * Those keys are now the reads' own, so the loaded type is inferred from the
 * fetcher rather than restated by hand, and there is one definition to keep
 * correct instead of two.
 *
 * Note there is no `"use client"` on this module, and both graphs import it: the
 * hooks run in the browser, while `page.tsx` — a Server Component — calls
 * `workspaceSnapshots` to seed the very same entries. `laneRead` and
 * `laneSnapshot` are isomorphic and never call a loader, so building a read on
 * the server costs one object.
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
  teams: () => laneRead({ key: ["teams"], loader: ({ meta }) => fetchTeams(meta) }),
  tasks: (filters: TaskFilters) =>
    laneRead({
      key: ["tasks", filters],
      loader: ({ meta }) => fetchTasks(meta, filters),
      ...BOARD_REVALIDATION,
    }),
  task: (taskId: string) =>
    laneRead({
      key: ["task", taskId],
      loader: ({ meta }) => fetchTask(meta, taskId),
    }),
  projects: () =>
    laneRead({
      key: ["projects"],
      loader: ({ meta }) => fetchProjects(meta),
      // Carries per-project task counts, so it moves whenever the board does.
      ...BOARD_REVALIDATION,
    }),
  labels: () =>
    laneRead({ key: ["labels"], loader: ({ meta }) => fetchLabels(meta) }),
  members: () =>
    laneRead({ key: ["members"], loader: ({ meta }) => fetchMembers(meta) }),
  insights: () =>
    laneRead({
      key: ["insights"],
      loader: ({ meta }) => fetchInsights(meta),
      ...BOARD_REVALIDATION,
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

export type WorkspaceSeeds = {
  currentUser: CurrentUser;
  teams: TeamSummary[];
  tasks: {
    filters: TaskFilters;
    data: Task[];
  };
  selectedTask: Task | null;
  projects: Project[];
  labels: TeamLabel[];
  members: TeamMember[];
  insights: Insights;
};

/**
 * The per-request seed the RSC route hands to `<LaneHydration>`, built from the
 * reads the browser will read with — `laneSnapshot` takes the read itself, so
 * the entry a snapshot names cannot drift from the entry that loads it, and
 * `data` is checked against what that read loads.
 */
export function workspaceSnapshots(
  seeds: WorkspaceSeeds,
): LaneHydrationSnapshots {
  const entries: LaneSnapshot[] = [
    laneSnapshot(workspaceReads.currentUser(), seeds.currentUser),
    laneSnapshot(workspaceReads.teams(), seeds.teams),
    laneSnapshot(workspaceReads.tasks(seeds.tasks.filters), seeds.tasks.data),
    laneSnapshot(workspaceReads.projects(), seeds.projects),
    laneSnapshot(workspaceReads.labels(), seeds.labels),
    laneSnapshot(workspaceReads.members(), seeds.members),
    laneSnapshot(workspaceReads.insights(), seeds.insights),
  ];

  if (seeds.selectedTask) {
    entries.push(
      laneSnapshot(
        workspaceReads.task(seeds.selectedTask.id),
        seeds.selectedTask,
      ),
    );
  }

  return { entries };
}
