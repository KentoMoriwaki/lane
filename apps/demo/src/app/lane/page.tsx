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
} from "@/app/lane/api/endpoints";
import {
  buildWorkspaceSearch,
  getterFromRecord,
  parseWorkspaceState,
} from "@/app/lane/api/url-state";
import { workspaceSnapshots } from "@/app/lane/api/query-options";
import { Workspace } from "@/app/lane/workspace/workspace";
import { WorkspaceProvider } from "@/app/lane/workspace/workspace-provider";

// The workspace is seeded per request from the embedded API, so it can never be
// statically prerendered (there is no server to fetch from at build time).
export const dynamic = "force-dynamic";

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
