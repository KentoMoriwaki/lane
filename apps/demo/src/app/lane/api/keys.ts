import type {
  CurrentUser,
  Insights,
  Project,
  Task,
  TeamLabel,
  TeamMember,
  TeamSummary,
} from "@/server/api";
import type { LaneHydrationSnapshots, LaneSnapshot } from "use-lane";
import type { TaskFilters } from "./endpoints";

/**
 * The workspace's keys, as plain arrays — and the only Lane-related module in
 * this variant that is **not** `"use client"`.
 *
 * That is load-bearing rather than tidiness: `page.tsx` is a Server Component
 * and builds the hydration snapshots there (`workspaceSnapshots` below), so the
 * module it imports must be server-safe. `laneKey` cannot be called here — it is
 * a runtime export of a `"use client"` package, which a server module only ever
 * sees as a client reference — so the *types* are attached one layer up, in
 * `lane-reads.ts`, and this module stays the single place each key literal is
 * written.
 *
 * Team-owned keys omit `teamId`: the active team travels in request headers, and
 * the workspace provider removes these keys when it changes (see
 * `TEAM_SCOPED_KEYS`). Session-level keys are kept separate.
 */
export const entryKeys = {
  currentUser: ["current-user"] as const,
  teams: ["teams"] as const,
  tasks: (filters: TaskFilters) => ["tasks", filters] as const,
  task: (taskId: string) => ["task", taskId] as const,
  projects: ["projects"] as const,
  labels: ["labels"] as const,
  members: ["members"] as const,
  insights: ["insights"] as const,
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

export function workspaceSnapshots(
  seeds: WorkspaceSeeds,
): LaneHydrationSnapshots {
  const entries: LaneSnapshot[] = [
    { data: seeds.currentUser, key: entryKeys.currentUser },
    { data: seeds.teams, key: entryKeys.teams },
    { data: seeds.tasks.data, key: entryKeys.tasks(seeds.tasks.filters) },
    { data: seeds.projects, key: entryKeys.projects },
    { data: seeds.labels, key: entryKeys.labels },
    { data: seeds.members, key: entryKeys.members },
    { data: seeds.insights, key: entryKeys.insights },
  ];

  if (seeds.selectedTask) {
    entries.push({
      data: seeds.selectedTask,
      key: entryKeys.task(seeds.selectedTask.id),
    });
  }

  return { entries };
}
