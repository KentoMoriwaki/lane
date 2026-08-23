import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  readAllTasks,
  readCurrentUser,
  readInsights,
  readLabels,
  readMembers,
  readProjectTaskCounts,
  readProjects,
  readTask,
  readTeams,
} from "@/app/lane/api/route-reads";
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
 * Both routes use the exact same reads, latency, URL contract, and static-shell
 * strategy, and this one keeps the mutation shape both started with: every
 * change is a Server Action that asks for a rerender, and the whole route comes
 * back as props. There is no keyed client store, hydration publication, or
 * external reader hidden behind an adapter — and no way to converge one row
 * without redrawing the workspace around it, which is what `/lane` is now the
 * comparison for.
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
  const currentUser = await readCurrentUser("");
  // Started before the guard so the common navigation — a filter, which never
  // names a team — pays one round trip for the whole workspace instead of
  // waiting on the roster first.
  const teamsRead = readTeams(currentUser.id);

  if (requested.teamId) {
    const roster = await teamsRead;

    if (!roster.some((team) => team.id === requested.teamId)) {
      const search = buildWorkspaceSearch({ ...requested, teamId: null });
      redirect(search ? `/app-router?${search}` : "/app-router");
    }
  }

  const activeTeamId = requested.teamId ?? currentUser.defaultTeamId;
  const ctx = { userId: currentUser.id, teamId: activeTeamId };
  const [
    teams,
    tasks,
    insights,
    projects,
    projectCounts,
    labels,
    members,
    selectedTask,
  ] = await Promise.all([
    teamsRead,
    readAllTasks(ctx, requested.filters),
    readInsights(ctx),
    readProjects(ctx),
    // The counts are their own read now, here as well: this route shares
    // `route-reads.ts`, and the roster it caches no longer carries a number
    // that a task can move (see that file). One extra line, and the baseline
    // keeps showing exactly what it showed.
    readProjectTaskCounts(ctx),
    readLabels(ctx),
    readMembers(ctx),
    requested.selectedTaskId
      ? readTask(ctx, requested.selectedTaskId)
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
      projectCounts={projectCounts}
      labels={labels}
      members={members}
      selectedTask={selectedTask}
    />
  );
}
