import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { fetchCurrentUser, fetchTeams } from "@/app/react-query/api/endpoints";
import {
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

// Match the Lane route's navigation contract: a reusable workspace shell is
// available immediately while the server prepares the hydration payload.
export const instant = true;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Keep the same shell-to-hydration boundary as the Lane route. The difference
 * begins after hydration: React Query hands ownership to its client cache,
 * while Lane's external readers continue to receive server-owned publications.
 */
export default function Page({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<WorkspaceLoadingShell />}>
      <WorkspaceHydration searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Reads the durable URL state, collects the matching initial data, dehydrates
 * the React Query cache, and hands ownership to the client tree. Keeping this
 * work below the page-level Suspense boundary lets it stream into the reusable
 * shell instead of blocking navigation into the route.
 */
async function WorkspaceHydration({ searchParams }: PageProps) {
  const queryClient = getQueryClient();
  const requested = parseWorkspaceState(getterFromRecord(await searchParams));

  // Resolve the mock-authenticated user (the API applies a default user when no
  // id is sent), then resolve which team this URL refers to.
  const user = await fetchCurrentUser({ userId: "", teamId: "" });
  const teams = await fetchTeams({ userId: user.id, teamId: "" });

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

  // Seed the already-fetched session queries to avoid refetching them.
  queryClient.setQueryData(currentUserQueryOptions(ctx).queryKey, user);
  queryClient.setQueryData(teamsQueryOptions(ctx).queryKey, teams);

  const prefetches = [
    queryClient.prefetchQuery(tasksQueryOptions(ctx, requested.filters)),
    queryClient.prefetchQuery(insightsQueryOptions(ctx)),
    queryClient.prefetchQuery(projectsQueryOptions(ctx)),
    queryClient.prefetchQuery(labelsQueryOptions(ctx)),
    queryClient.prefetchQuery(membersQueryOptions(ctx)),
  ];

  // Deep-linked task detail: prefetch it so the panel renders immediately.
  if (requested.selectedTaskId) {
    prefetches.push(
      queryClient.prefetchQuery(
        taskQueryOptions(ctx, requested.selectedTaskId),
      ),
    );
  }

  await Promise.all(prefetches);

  return (
    <WorkspaceProvider initialUser={user} initialTeamId={teamId}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Workspace />
      </HydrationBoundary>
    </WorkspaceProvider>
  );
}
