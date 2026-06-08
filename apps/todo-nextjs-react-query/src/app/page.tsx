import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { EMPTY_FILTERS, fetchCurrentUser } from "@/api/endpoints";
import {
  currentUserQueryOptions,
  insightsQueryOptions,
  labelsQueryOptions,
  membersQueryOptions,
  projectsQueryOptions,
  tasksQueryOptions,
  teamsQueryOptions,
} from "@/api/query-options";
import { getQueryClient } from "@/lib/get-query-client";
import { Workspace } from "@/workspace/workspace";
import { WorkspaceProvider } from "@/workspace/workspace-provider";

/**
 * Server Component entry point. It collects the initial data, dehydrates the
 * React Query cache, and hands ownership to the client tree. After this point
 * the server no longer owns the displayed data — the client query cache does.
 */
export default async function Page() {
  const queryClient = getQueryClient();

  // Resolve the mock-authenticated user first (the API applies a default user
  // when no id is sent), then prefetch the active team's workspace.
  const user = await fetchCurrentUser({ userId: "", teamId: "" });
  const ctx = { userId: user.id, teamId: user.defaultTeamId };

  queryClient.setQueryData(currentUserQueryOptions(ctx).queryKey, user);

  await Promise.all([
    queryClient.prefetchQuery(teamsQueryOptions(ctx)),
    queryClient.prefetchQuery(tasksQueryOptions(ctx, EMPTY_FILTERS)),
    queryClient.prefetchQuery(insightsQueryOptions(ctx)),
    queryClient.prefetchQuery(projectsQueryOptions(ctx)),
    queryClient.prefetchQuery(labelsQueryOptions(ctx)),
    queryClient.prefetchQuery(membersQueryOptions(ctx)),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkspaceProvider initialUser={user} initialTeamId={ctx.teamId}>
        <Workspace />
      </WorkspaceProvider>
    </HydrationBoundary>
  );
}
