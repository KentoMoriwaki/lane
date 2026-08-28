import type { ReactNode } from "react";
import { notFound } from "next/navigation";
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
import { ProjectHeader } from "@/app/lane/workspace/project-header";
import {
  TaskDetailPanel,
  TaskMissingPanel,
} from "@/app/lane/workspace/task-detail-panel";
import {
  ALL_WORKSPACE_CONTEXT,
  contextForKey,
  filtersForContext,
  isStaticWorkspaceContextKey,
  projectPath,
  type WorkspaceListContext,
} from "@/app/lane/workspace/workspace-context";

/**
 * One publication per region, each behind its own Suspense boundary.
 *
 * The route used to read everything in a single component and hand
 * `<LaneHydration>` one bundle. That made the whole screen one dynamic unit:
 * the 66ms task list waited on the 1245ms project read, and nothing above the
 * single boundary could be prerendered because the read sat above it.
 *
 * The list region keeps its publication around the readers that consume it.
 * The Sidebar is the one intentional cross-tree reader: it persists in the
 * shared layout while each page publishes the active team's reference data.
 * Independent reads still arrive in pieces instead of waiting on one
 * whole-workspace bundle.
 *
 * Every region read is dynamic, so a rerender reaches the current source for
 * every value it republishes. That cost is deliberately visible in this demo;
 * an inline edit avoids it entirely when the write's response already answers
 * every key it moved (`api/hooks.ts`).
 *
 * `TaskDetailRegion` belongs to the intercepted task route. It publishes only
 * the entity: a row navigation keeps the existing Context publication, while
 * a direct task visit establishes All tasks before it enters this route.
 *
 * Each region resolves the session itself rather than receiving it. That is
 * what keeps the frame free of awaits, and `getSession` is `cache`d so the
 * regions share one `/api/me` per render pass.
 */

export type RegionProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  contextParams?: Promise<{ context: string }>;
  projectParams?: Promise<{ projectId: string }>;
};

async function requested({
  searchParams,
  contextParams,
  projectParams,
}: RegionProps) {
  const [record, generatedContext, project] = await Promise.all([
    searchParams,
    contextParams ?? Promise.resolve(null),
    projectParams ?? Promise.resolve(null),
  ]);
  const state = parseWorkspaceState(getterFromRecord(record));
  let context: WorkspaceListContext;

  if (generatedContext) {
    if (!isStaticWorkspaceContextKey(generatedContext.context)) notFound();
    context = contextForKey(generatedContext.context);
  } else if (project) {
    context = {
      key: "project",
      pathname: projectPath(project.projectId),
      projectId: project.projectId,
    };
  } else {
    context = ALL_WORKSPACE_CONTEXT;
  }

  return { ...state, filters: filtersForContext(state.filters, context) };
}

/** Publish the data consumed by the Sidebar mounted in the shared layout. */
export async function SidebarDataRegion({ searchParams }: RegionProps) {
  const state = await requested({ searchParams });
  const ctx = await getWorkspaceCtx(state.teamId);
  // More than the sidebar draws: this is where the list route publishes its
  // reference data, and the create dialog's pickers read it from here (see
  // `workspaceSnapshots.sidebar`).
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
      {null}
    </LaneHydration>
  );
}

/** Resolve the project id while its reference data arrives from the Sidebar region. */
export async function ProjectHeaderRegion({
  projectParams,
}: Pick<RegionProps, "projectParams">) {
  if (!projectParams) return null;
  const { projectId } = await projectParams;
  return <ProjectHeader projectId={projectId} />;
}

/** Publish page 1 around the page-owned readers that consume it. */
export async function TaskListRegion({
  children,
  ...props
}: RegionProps & { children: ReactNode }) {
  const state = await requested(props);
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
      {children}
    </LaneHydration>
  );
}

export type TaskRegionProps = RegionProps & {
  params: Promise<{ taskId: string }>;
};

export async function TaskDetailRegion({
  params,
  searchParams,
}: TaskRegionProps) {
  const [{ taskId }, state] = await Promise.all([
    params,
    requested({ searchParams }),
  ]);
  const ctx = await getWorkspaceCtx(state.teamId);
  // Reference data is published by the workspace page. This region owns only
  // the task; its client reader consumes the other keys across the same Lane.
  const task = await readTask(ctx, taskId);

  // A task deleted from another tab, or an id someone typed. Nothing is
  // published for it: an `external` read with no publication would wait for one
  // that is never coming, so the route says so instead.
  if (!task) {
    return <TaskMissingPanel taskId={taskId} />;
  }

  return (
    <LaneHydration snapshots={workspaceSnapshots.detail({ task })}>
      <TaskDetailPanel taskId={task.id} />
    </LaneHydration>
  );
}
