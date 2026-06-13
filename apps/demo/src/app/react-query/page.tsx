import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { fetchCurrentUser, fetchTeams } from "@/rq/api/endpoints";
import {
  currentUserQueryOptions,
  insightsQueryOptions,
  labelsQueryOptions,
  membersQueryOptions,
  projectsQueryOptions,
  taskQueryOptions,
  tasksQueryOptions,
  teamsQueryOptions,
} from "@/rq/api/query-options";
import {
  buildWorkspaceSearch,
  getterFromRecord,
  parseWorkspaceState,
} from "@/rq/api/url-state";
import { getQueryClient } from "@/rq/get-query-client";
import { Workspace } from "@/rq/workspace/workspace";
import { WorkspaceProvider } from "@/rq/workspace/workspace-provider";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Server Component entry point. It reads the durable view state from the URL,
 * collects the matching initial data, dehydrates the React Query cache, and
 * hands ownership to the client tree. This is what makes reload and deep-links
 * restore the same workspace; after hydration the client query cache owns the
 * data and same-workspace filter/search changes never reload this component.
 */
export default async function Page({ searchParams }: PageProps) {
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
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <WorkspaceProvider initialUser={user} initialTeamId={teamId}>
          <Workspace />
        </WorkspaceProvider>
      </Suspense>
    </HydrationBoundary>
  );
}
