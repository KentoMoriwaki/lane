import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { fetchTasksByIds } from "@/app/react-query/api/endpoints";
import {
  blockedByTasksQueryOptions,
  blockingTasksQueryOptions,
  currentUserQueryOptions,
  insightsQueryOptions,
  labelsQueryOptions,
  membersQueryOptions,
  projectsQueryOptions,
  taskQueryOptions,
  tasksQueryOptions,
  teamsQueryOptions,
} from "@/app/react-query/api/query-options";
import {
  buildWorkspaceSearch,
  getterFromRecord,
  parseWorkspaceState,
} from "@/app/react-query/api/url-state";
import { getQueryClient } from "@/app/react-query/get-query-client";
import { Workspace } from "@/app/react-query/workspace/workspace";
import { WorkspaceLoadingShell } from "@/app/react-query/workspace/workspace-loading-shell";
import { WorkspaceProvider } from "@/app/react-query/workspace/workspace-provider";
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

// Match the Lane route's navigation contract: a reusable workspace shell is
// available immediately while the server prepares the hydration payload.
export const instant = true;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Keep the same shell-to-hydration boundary as the Lane route. The difference
 * is the receiving store: React Query merges each publication into one mutable
 * browser QueryClient, while Lane's external readers keep the publication
 * itself authoritative.
 */
export default function Page({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<WorkspaceLoadingShell />}>
      <WorkspaceHydration searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Reads the durable URL state, collects a tagged server generation, and
 * dehydrates it into the browser's one QueryClient. The same boundary runs
 * again inside a Server Action response after `updateTag`: unlike the initial
 * handoff, that is a post-mutation merge into an already-populated store.
 * Keeping this work below the page-level Suspense boundary lets both generations
 * stream into the reusable shell instead of blocking navigation into the route.
 */
async function WorkspaceHydration({ searchParams }: PageProps) {
  const queryClient = getQueryClient();
  const requested = parseWorkspaceState(getterFromRecord(await searchParams));

  // Resolve the mock-authenticated user (the API applies a default user when no
  // id is sent), then resolve which team this URL refers to.
  const user = await getCachedCurrentUser("");
  const teams = await getCachedTeams(user.id);

  // Canonicalize an unknown / non-member `team` param before doing anything
  // else: drop it and redirect so the URL the client sees always matches the
  // team the server resolves. The provider derives the active team from the
  // URL, so a stale param would otherwise desync the client request context
  // from the hydrated data (and break later refresh/mutations).
  if (requested.teamId && !teams.some((team) => team.id === requested.teamId)) {
    const search = buildWorkspaceSearch({ ...requested, teamId: null });
    redirect(search ? `/react-query?${search}` : "/react-query");
  }

  const teamId = requested.teamId ?? user.defaultTeamId;
  const ctx = { userId: user.id, teamId };

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

  // `setQueryData` records this server generation's completion time as
  // `dataUpdatedAt`. On mutation, that timestamp is later than the optimistic
  // browser write performed before the delayed action, so HydrationBoundary
  // queues these existing queries and applies them in its post-commit effect.
  // If the transition is aborted, TanStack deliberately discards this update.
  queryClient.setQueryData(currentUserQueryOptions(ctx).queryKey, user);
  queryClient.setQueryData(teamsQueryOptions(ctx).queryKey, teams);
  queryClient.setQueryData(
    tasksQueryOptions(ctx, requested.filters).queryKey,
    tasks,
  );
  queryClient.setQueryData(insightsQueryOptions(ctx).queryKey, insights);
  queryClient.setQueryData(projectsQueryOptions(ctx).queryKey, projects);
  queryClient.setQueryData(labelsQueryOptions(ctx).queryKey, labels);
  queryClient.setQueryData(membersQueryOptions(ctx).queryKey, members);

  if (requested.selectedTaskId && selectedTask) {
    queryClient.setQueryData(
      taskQueryOptions(ctx, requested.selectedTaskId).queryKey,
      selectedTask,
    );

    // Dependency queries also contain copies of tasks. Prefetch the mounted
    // detail panel's copies into this generation so a status mutation does not
    // need a browser GET to repair its dependency verdict.
    const [blockedBy, blocking] = await Promise.all([
      selectedTask.blockedBy.length > 0
        ? fetchTasksByIds(ctx, selectedTask.blockedBy)
        : Promise.resolve([]),
      selectedTask.blocks.length > 0
        ? fetchTasksByIds(ctx, selectedTask.blocks)
        : Promise.resolve([]),
    ]);
    queryClient.setQueryData(
      blockedByTasksQueryOptions(
        ctx,
        requested.selectedTaskId,
        selectedTask.blockedBy,
      ).queryKey,
      blockedBy,
    );
    queryClient.setQueryData(
      blockingTasksQueryOptions(
        ctx,
        requested.selectedTaskId,
        selectedTask.blocks,
      ).queryKey,
      blocking,
    );
  }

  return (
    <WorkspaceProvider initialUser={user} initialTeamId={teamId}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Workspace />
      </HydrationBoundary>
    </WorkspaceProvider>
  );
}
