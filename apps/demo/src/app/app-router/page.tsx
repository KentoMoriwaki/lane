import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  getCachedCurrentUser,
  getCachedInsights,
  getCachedLabels,
  getCachedMembers,
  getCachedProjects,
  getCachedTask,
  getCachedTasks,
  getCachedTeams,
} from "@/app/lane/api/cached-endpoints";
import {
  buildWorkspaceSearch,
  getterFromRecord,
  parseWorkspaceState,
} from "@/app/lane/api/url-state";
import { Workspace } from "./workspace/workspace";
import { WorkspaceLoadingShell } from "./workspace/workspace-loading-shell";

export const instant = true;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Plain App Router baseline for the server-owned Lane demo.
 *
 * Both routes use the exact same cached functions, cache tags, mutation
 * actions, latency, URL contract, and static-shell strategy. The difference is
 * only distribution: this route resolves ordinary values and passes them down
 * as props. There is no keyed client store, hydration publication, or external
 * reader hidden behind an adapter.
 */
export default function Page({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<WorkspaceLoadingShell />}>
      <WorkspaceContent searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkspaceContent({ searchParams }: PageProps) {
  const requested = parseWorkspaceState(getterFromRecord(await searchParams));
  const currentUser = await getCachedCurrentUser("");
  const teams = await getCachedTeams(currentUser.id);

  if (requested.teamId && !teams.some((team) => team.id === requested.teamId)) {
    const search = buildWorkspaceSearch({ ...requested, teamId: null });
    redirect(search ? `/app-router?${search}` : "/app-router");
  }

  const activeTeamId = requested.teamId ?? currentUser.defaultTeamId;
  const ctx = { userId: currentUser.id, teamId: activeTeamId };
  const [tasks, insights, projects, labels, members, selectedTask] =
    await Promise.all([
      getCachedTasks(ctx, requested.filters),
      getCachedInsights(ctx),
      getCachedProjects(ctx),
      getCachedLabels(ctx),
      getCachedMembers(ctx),
      requested.selectedTaskId
        ? getCachedTask(ctx, requested.selectedTaskId)
        : Promise.resolve(null),
    ]);

  return (
    <Workspace
      currentUser={currentUser}
      teams={teams}
      activeTeamId={activeTeamId}
      tasks={tasks}
      insights={insights}
      projects={projects}
      labels={labels}
      members={members}
      selectedTask={selectedTask}
    />
  );
}
