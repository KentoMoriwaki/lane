import type {
  CurrentUser,
  Insights,
  Project,
  Task,
  TeamLabel,
  TeamMember,
  TeamSummary,
} from "@lane/todo-api";
import type { LaneEntrySeed } from "@lane/lane";
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

export function workspaceSeedEntries(
  seeds: WorkspaceSeeds,
): LaneEntrySeed[] {
  const entries: LaneEntrySeed[] = [
    [queryKeys.currentUser, seeds.currentUser],
    [queryKeys.teams, seeds.teams],
    [queryKeys.tasks(seeds.tasks.filters), seeds.tasks.data],
    [queryKeys.projects, seeds.projects],
    [queryKeys.labels, seeds.labels],
    [queryKeys.members, seeds.members],
    [queryKeys.insights, seeds.insights],
  ];

  if (seeds.selectedTask) {
    entries.push([
      queryKeys.task(seeds.selectedTask.id),
      seeds.selectedTask,
    ]);
  }

  return entries;
}
