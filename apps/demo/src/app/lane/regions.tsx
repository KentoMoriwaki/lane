import { LaneHydration } from "use-lane";
import { workspaceSnapshots } from "@/app/lane/api/lane-reads";
import {
  readInsights,
  readLabels,
  readMembers,
  readProjectTaskCounts,
  readProjects,
  readTask,
  readTasks,
} from "@/app/lane/api/route-reads";
import { getSession, getTeams, getWorkspaceCtx } from "@/app/lane/api/session";
import { parseWorkspaceState, getterFromRecord } from "@/app/lane/api/url-state";
import { FilterBar } from "@/app/lane/workspace/filter-bar";
import { InsightStrip } from "@/app/lane/workspace/insight-strip";
import { Sidebar } from "@/app/lane/workspace/sidebar";
import {
  TaskDetailPage,
  TaskDetailPanel,
  TaskMissingPage,
  TaskMissingPanel,
} from "@/app/lane/workspace/task-detail-panel";
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
 * the keys its leaf reads. Coherence is unchanged: whatever asks for a rerender
 * — a Server Action's `refresh()`, or the `router.refresh()` Lane fires for a
 * key a mutation marked stale — renders this whole file, and every region
 * republishes. It simply arrives in pieces instead of all at once.
 *
 * What a rerender costs is not the whole file, though. `readProjects`,
 * `readLabels` and `readMembers` are `"use cache"` (see `api/route-reads.ts`),
 * so a background rerender for stale insights re-reads the tasks, the project
 * counts, the open task and the insights, and nothing else reaches the API.
 *
 * The last region here belongs to a different route. `TaskDetailRegion` is
 * rendered by `task/[id]/page.tsx` and by its intercepted twin under
 * `@modal/(.)task/[id]`, and it publishes the same keys for both — the surface
 * only decides which shell is drawn around the detail and how an edit made
 * there converges (`api/hooks.ts`).
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
  // More than the sidebar draws: this is where the list route publishes its
  // reference data, and the create dialog's pickers read it from here (see
  // `workspaceSnapshots.sidebar`). Three of the five are cached reads.
  const [currentUser, teams, insights, projects, projectCounts, labels, members] =
    await Promise.all([
      getSession(),
      getTeams(),
      readInsights(ctx),
      readProjects(ctx),
      readProjectTaskCounts(ctx),
      readLabels(ctx),
      readMembers(ctx),
    ]);

  return (
    <LaneHydration
      snapshots={workspaceSnapshots.sidebar({
        currentUser,
        teams,
        insights,
        projects,
        projectCounts,
        labels,
        members,
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
    // Page 1. The browser reads the rest on the same key (`api/lane-reads.ts`).
    readTasks(ctx, state.filters, { cursor: null }),
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
  // Page 1, and only ever page 1: what this route publishes is the first page
  // of the list, and the depth on top of it is the browser's (`api/hooks.ts`).
  const tasks = await readTasks(ctx, state.filters, { cursor: null });

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

/** Which route is rendering the detail — see `TaskDetailRegion`. */
export type TaskSurface = "panel" | "page";

export type TaskRegionProps = RegionProps & {
  params: Promise<{ id: string }>;
  surface: TaskSurface;
};

export async function TaskDetailRegion({
  params,
  searchParams,
  surface,
}: TaskRegionProps) {
  const [{ id }, state] = await Promise.all([params, requested(searchParams)]);
  const ctx = await getWorkspaceCtx(state.teamId);
  // The counts are read here only for the page, which has no sidebar beside it
  // to have published them. In the panel the list route already did, and this
  // region reading them again would cost a second trip to the source for the
  // same number in the same render.
  const [members, projects, labels, task, projectCounts] = await Promise.all([
    readMembers(ctx),
    readProjects(ctx),
    readLabels(ctx),
    readTask(ctx, id),
    surface === "page" ? readProjectTaskCounts(ctx) : Promise.resolve(undefined),
  ]);

  // A task deleted from another tab, or an id someone typed. Nothing is
  // published for it: an `external` read with no publication would wait for one
  // that is never coming, so the surface says so instead.
  if (!task) {
    return surface === "panel" ? <TaskMissingPanel /> : <TaskMissingPage />;
  }

  return (
    <LaneHydration
      snapshots={workspaceSnapshots.detail({
        members,
        projects,
        projectCounts,
        labels,
        task,
      })}
    >
      {surface === "panel" ? (
        <TaskDetailPanel taskId={task.id} />
      ) : (
        <TaskDetailPage taskId={task.id} />
      )}
    </LaneHydration>
  );
}
