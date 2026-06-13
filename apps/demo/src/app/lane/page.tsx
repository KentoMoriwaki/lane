import { LaneHydration, LaneProvider } from "use-lane";
import { redirect } from "next/navigation";
import {
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasks,
  fetchTeams,
} from "@/api/endpoints";
import {
  buildWorkspaceSearch,
  getterFromRecord,
  parseWorkspaceState,
} from "@/api/url-state";
import { workspaceSnapshots } from "@/api/query-options";
import { Workspace } from "@/workspace/workspace";
import { WorkspaceProvider } from "@/workspace/workspace-provider";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const requested = parseWorkspaceState(getterFromRecord(await searchParams));
  const user = await fetchCurrentUser({ userId: "", teamId: "" });
  const teams = await fetchTeams({ userId: user.id, teamId: "" });

  if (requested.teamId && !teams.some((team) => team.id === requested.teamId)) {
    const search = buildWorkspaceSearch({ ...requested, teamId: null });
    redirect(search ? `/lane?${search}` : "/lane");
  }

  const teamId = requested.teamId ?? user.defaultTeamId;
  const ctx = { userId: user.id, teamId };
  const [
    tasks,
    insights,
    projects,
    labels,
    members,
    selectedTask,
  ] = await Promise.all([
    fetchTasks(ctx, requested.filters),
    fetchInsights(ctx),
    fetchProjects(ctx),
    fetchLabels(ctx),
    fetchMembers(ctx),
    requested.selectedTaskId
      ? fetchTask(ctx, requested.selectedTaskId).catch(() => null)
      : Promise.resolve(null),
  ]);
  const snapshots = workspaceSnapshots({
    currentUser: user,
    insights,
    labels,
    members,
    projects,
    selectedTask,
    tasks: {
      data: tasks,
      filters: requested.filters,
    },
    teams,
  });

  return (
    <LaneProvider>
      <WorkspaceProvider initialUser={user} initialTeamId={teamId}>
        <LaneHydration snapshots={snapshots}>
          <Workspace />
        </LaneHydration>
      </WorkspaceProvider>
    </LaneProvider>
  );
}
