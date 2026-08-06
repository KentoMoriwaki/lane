import { external, laneRead, laneSnapshot } from "use-lane";
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
import type { TaskFilters } from "./endpoints";

/**
 * Every read this workspace performs, defined once — and every one of them is
 * `external`: **this client does not fetch its workspace.** The route seeds these
 * keys from the server on every render (see `workspaceSnapshots` below and
 * `page.tsx`), and `external` is how a read says so — a real loader that waits
 * for the publication instead of going after the data itself.
 *
 * The freshness options are gone with the loaders, and their absence is the
 * point rather than an omission: `staleTime`, `gcTime`, `refetchOnFocus` and
 * `refetchOnMount` are all instructions to a fetcher this read does not have.
 * Freshness here is the server's to decide, and it decides it the same way it
 * decides everything else — by publishing. The type will not even let these
 * reads carry the options (the external spec has no room for them), which is
 * what keeps "server-owned" from quietly eroding one option at a time.
 *
 * `T` has to be written out for the same reason: nothing is inferred from a
 * loader that never loads. It is the one cost of the form, and it is paid once,
 * here.
 *
 * What is worth noticing is what is **not** here: a second map of keys. Each
 * factory takes exactly what decides its key — `tasks(filters)`, `task(taskId)` —
 * and the session the loaders need arrives from the lane as `meta` (declared in
 * `@/lib/lane-meta`, supplied by `WorkspaceProvider`). So a read is a plain
 * object that costs nothing to build, and `.key` is reachable from anywhere:
 *
 * ```ts
 * laneSnapshot(workspaceReads.insights(), insights);  // the server publishes
 * useLane(workspaceReads.insights());                 // the client reads
 * ```
 *
 * Those are the only two things anyone does with these reads. There is no third
 * line writing to `.key` — `lane.set` / `update` / `invalidate` / `remove` all
 * throw on a key a publication seeded, and the mutations live in `actions.ts`
 * instead, where a change ends in a republication rather than in a local edit.
 *
 * Note there is no `"use client"` on this module, and both graphs import it: the
 * components read in the browser, while `page.tsx` — a Server Component — calls
 * `workspaceSnapshots` to seed the very same entries. `laneRead` and
 * `laneSnapshot` are isomorphic and never call a loader, so building a read on
 * the server costs one object.
 *
 * Team-owned keys omit `teamId`: the active team travels in request headers, so
 * switching teams does not rename a single key. It does not have to — a switch
 * is a navigation, the route re-renders for the new team, and the publication
 * that follows overwrites every one of these keys. The client-owned variants
 * have to evict them by hand; here the same event that changes the team is the
 * one that republishes them.
 */
export const workspaceReads = {
  currentUser: () =>
    laneRead<CurrentUser>({ key: ["current-user"], loader: external }),
  teams: () => laneRead<TeamSummary[]>({ key: ["teams"], loader: external }),
  tasks: (filters: TaskFilters) =>
    laneRead<Task[]>({ key: ["tasks", filters], loader: external }),
  task: (taskId: string) =>
    laneRead<Task>({ key: ["task", taskId], loader: external }),
  projects: () => laneRead<Project[]>({ key: ["projects"], loader: external }),
  labels: () => laneRead<TeamLabel[]>({ key: ["labels"], loader: external }),
  members: () => laneRead<TeamMember[]>({ key: ["members"], loader: external }),
  insights: () => laneRead<Insights>({ key: ["insights"], loader: external }),
};

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
