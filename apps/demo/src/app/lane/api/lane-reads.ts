import { laneKey, laneRead } from "use-lane";
import type { LaneHydrationSnapshots, LaneKeyOf, LaneSnapshot } from "use-lane";
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

/**
 * Every key this workspace addresses, carrying what its entry holds.
 *
 * `laneKey<T>` is what makes a write checked — `lane.set` here cannot put a
 * `Project` under a task key — and this layer deliberately holds **no loaders**,
 * because addressing an entry never needs one. That is what lets `publishTask`
 * (in `hooks.ts`) take no request context at all.
 *
 * Note there is no `"use client"` on this module, and it is imported by both
 * graphs: the hooks below run in the browser, while `page.tsx` — a Server
 * Component — calls `workspaceSnapshots` to seed the very same keys. `laneKey`
 * and `laneRead` are isomorphic and `use-lane` marks its React modules
 * individually, so the key literals live in exactly one place for both.
 *
 * Team-owned keys omit `teamId`: the active team travels in request headers, and
 * the workspace provider removes these keys when it changes (see
 * `TEAM_SCOPED_KEYS`). Session-level keys are kept separate.
 */
export const laneKeys = {
  currentUser: () => laneKey<CurrentUser>(["current-user"]),
  teams: () => laneKey<TeamSummary[]>(["teams"]),
  tasks: (filters: TaskFilters) => laneKey<Task[]>(["tasks", filters]),
  task: (taskId: string) => laneKey<Task>(["task", taskId]),
  projects: () => laneKey<Project[]>(["projects"]),
  labels: () => laneKey<TeamLabel[]>(["labels"]),
  members: () => laneKey<TeamMember[]>(["members"]),
  insights: () => laneKey<Insights>(["insights"]),
};

/**
 * The key families that belong to the active team and are removed when it
 * changes. Prefix *scopes*, not keys — they name a family of entries rather than
 * one, so they carry no type.
 */
export const TEAM_SCOPED_KEYS = [
  ["tasks"],
  ["task"],
  ["projects"],
  ["labels"],
  ["members"],
  ["insights"],
] as const;

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
 * Pairs a typed key with the value seeded under it. `LaneSnapshot.key` is a
 * plain `LaneKey`, so a bare object literal would let any `data` through; taking
 * the key as `LaneKeyOf<T>` infers `T` from the key and checks `data` against
 * it. Worth the three lines here specifically, because a mismatched pair on this
 * path hydrates a reader with the wrong shape rather than failing a fetch.
 */
const snapshot = <T>(key: LaneKeyOf<T>, data: T): LaneSnapshot<T> => ({
  key,
  data,
});

/**
 * The per-request seed the RSC route hands to `<LaneHydration>`, built from the
 * same `laneKeys` the browser reads with — which is the point of there being one
 * key module rather than a server-safe list plus a typed copy of it.
 */
export function workspaceSnapshots(
  seeds: WorkspaceSeeds,
): LaneHydrationSnapshots {
  const entries: LaneSnapshot[] = [
    snapshot(laneKeys.currentUser(), seeds.currentUser),
    snapshot(laneKeys.teams(), seeds.teams),
    snapshot(laneKeys.tasks(seeds.tasks.filters), seeds.tasks.data),
    snapshot(laneKeys.projects(), seeds.projects),
    snapshot(laneKeys.labels(), seeds.labels),
    snapshot(laneKeys.members(), seeds.members),
    snapshot(laneKeys.insights(), seeds.insights),
  ];

  if (seeds.selectedTask) {
    entries.push(
      snapshot(laneKeys.task(seeds.selectedTask.id), seeds.selectedTask),
    );
  }

  return { entries };
}
