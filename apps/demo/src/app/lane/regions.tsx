import { LaneHydration } from "use-lane";
import { workspaceSnapshots } from "@/app/lane/api/lane-reads";
import {
  readInsights,
  readLabels,
  readMembers,
  readProjects,
  readTask,
  readTasks,
} from "@/app/lane/api/route-reads";
import { getSession, getTeams, getWorkspaceCtx } from "@/app/lane/api/session";
import { parseWorkspaceState, getterFromRecord } from "@/app/lane/api/url-state";
import { FilterBar } from "@/app/lane/workspace/filter-bar";
import { InsightStrip } from "@/app/lane/workspace/insight-strip";
import { Sidebar } from "@/app/lane/workspace/sidebar";
import { TaskDetailPanel } from "@/app/lane/workspace/task-detail-panel";
import { TaskList } from "@/app/lane/workspace/task-list";

/**
 * One publication per region, each behind its own Suspense boundary.
 *
 * The route used to read everything in a single component and hand
 * `<LaneHydration>` one bundle. That made the whole screen one dynamic unit:
 * the 66ms task list waited on the 1245ms project read, and nothing above the
 * single boundary could be prerendered because the read sat above it.
 *
 * Splitting the publication is what `LaneHydration` nesting is for — a reader's
 * seeds may come from any boundary in its lineage, so a region can publish just
 * the keys its leaf reads. Coherence is unchanged: a mutation calls `refresh()`,
 * the route renders again, and every region republishes. It simply arrives in
 * pieces now instead of all at once.
 *
 * Each region resolves the session itself rather than receiving it. That is
 * what keeps the frame free of awaits, and `getSession` is `cache`d so the
 * regions share one `/api/me` per render pass.
 */

export type RegionProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function requested(searchParams: RegionProps["searchParams"]) {
  return parseWorkspaceState(getterFromRecord(await searchParams));
}

export async function SidebarRegion({ searchParams }: RegionProps) {
  const state = await requested(searchParams);
  const ctx = await getWorkspaceCtx(state.teamId);
  const [currentUser, teams, insights, projects, labels] = await Promise.all([
    getSession(),
    getTeams(),
    readInsights(ctx),
    readProjects(ctx),
    readLabels(ctx),
  ]);

  return (
    <LaneHydration
      snapshots={workspaceSnapshots.sidebar({
        currentUser,
        teams,
        insights,
        projects,
        labels,
      })}
    >
      <Sidebar />
    </LaneHydration>
  );
}

export async function InsightStripRegion({ searchParams }: RegionProps) {
  const state = await requested(searchParams);
  const ctx = await getWorkspaceCtx(state.teamId);
  const insights = await readInsights(ctx);

  return (
    <LaneHydration snapshots={workspaceSnapshots.insights(insights)}>
      <InsightStrip />
    </LaneHydration>
  );
}

export async function FilterBarRegion({ searchParams }: RegionProps) {
  const state = await requested(searchParams);
  const ctx = await getWorkspaceCtx(state.teamId);
  const [projects, labels, tasks] = await Promise.all([
    readProjects(ctx),
    readLabels(ctx),
    readTasks(ctx, state.filters),
  ]);

  return (
    <LaneHydration
      snapshots={workspaceSnapshots.filterBar({
        projects,
        labels,
        tasks: { data: tasks, filters: state.filters },
      })}
    >
      <FilterBar />
    </LaneHydration>
  );
}

export async function TaskListRegion({ searchParams }: RegionProps) {
  const state = await requested(searchParams);
  const ctx = await getWorkspaceCtx(state.teamId);
  const tasks = await readTasks(ctx, state.filters);

  return (
    <LaneHydration
      snapshots={workspaceSnapshots.tasks({
        data: tasks,
        filters: state.filters,
      })}
    >
      <TaskList />
    </LaneHydration>
  );
}

export async function TaskDetailRegion({ searchParams }: RegionProps) {
  const state = await requested(searchParams);
  const ctx = await getWorkspaceCtx(state.teamId);
  const [members, projects, labels, selectedTask] = await Promise.all([
    readMembers(ctx),
    readProjects(ctx),
    readLabels(ctx),
    state.selectedTaskId
      ? readTask(ctx, state.selectedTaskId)
      : Promise.resolve(null),
  ]);

  return (
    <LaneHydration
      snapshots={workspaceSnapshots.detail({
        members,
        projects,
        labels,
        selectedTask,
      })}
    >
      <TaskDetailPanel />
    </LaneHydration>
  );
}
