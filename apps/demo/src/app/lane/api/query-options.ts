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

export const queryKeys = {
  currentUser: ["current-user"] as const,
  teams: ["teams"] as const,
  tasks: (filters: TaskFilters) => ["tasks", filters] as const,
  task: (taskId: string) => ["task", taskId] as const,
  projects: ["projects"] as const,
  labels: ["labels"] as const,
  members: ["members"] as const,
  insights: ["insights"] as const,
};

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
    { data: seeds.currentUser, key: queryKeys.currentUser },
    { data: seeds.teams, key: queryKeys.teams },
    { data: seeds.tasks.data, key: queryKeys.tasks(seeds.tasks.filters) },
    { data: seeds.projects, key: queryKeys.projects },
    { data: seeds.labels, key: queryKeys.labels },
    { data: seeds.members, key: queryKeys.members },
    { data: seeds.insights, key: queryKeys.insights },
  ];

  if (seeds.selectedTask) {
    entries.push({
      data: seeds.selectedTask,
      key: queryKeys.task(seeds.selectedTask.id),
    });
  }

  return { entries };
}
