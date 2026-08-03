import { LaneHydration } from "use-lane";
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
import { workspaceSnapshots } from "@/app/lane/api/lane-reads";
import {
  buildWorkspaceSearch,
  getterFromRecord,
  parseWorkspaceState,
} from "@/app/lane/api/url-state";
import { Workspace } from "@/app/lane/workspace/workspace";
import { WorkspaceLoadingShell } from "@/app/lane/workspace/workspace-loading-shell";
import { WorkspaceProvider } from "@/app/lane/workspace/workspace-provider";

// Keep Instant Insights focused on this migration target. The dynamic workspace
// publication must stream into the reusable shell rather than blocking it.
export const instant = true;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * **The server-owned variant.** This route is the sole supplier of the
 * workspace: it reads everything the screen shows and publishes it into Lane
 * through `<LaneHydration>`, and the browser reads those keys with `external` —
 * a loader that waits for the publication rather than fetching anything itself.
 *
 * Which makes this render the *only* thing that puts data on screen, in every
 * sense. It runs again for each navigation (a filter, a selection, a team
 * switch, all of which live in the URL) and again after each server action
 * (`api/actions.ts` mutates, then `updateTag` brings the payload back
 * through here). One publication then updates the task, the lists it appears in,
 * the project counts and the insights together. Next's tagged server caches
 * keep those reads fresh as coherence domains; Lane publishes the resulting
 * payload without creating a second client-owned freshness policy.
 *
 * The discipline that buys it: the client never writes to these keys. Lane
 * enforces that — `set` / `update` / `invalidate` / `remove` throw on a key a
 * publication seeded, and `useLane` hands back no `invalidate` for an external
 * read — so the rule cannot decay into "mostly server-owned". Where the round
 * trip is too slow to feel right, `useOptimistic` covers it over the read value
 * (see the detail panel and the task rows), which is a display concern and never
 * a write.
 *
 * `/lane-spa` is the same workspace with the opposite answer: no seeding, client
 * loaders, and the cache maintenance that comes with owning your own data.
 */
export default function Page({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<WorkspaceLoadingShell />}>
      <WorkspacePublication searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * The publication is intentionally below the page-level Suspense boundary.
 * `searchParams` is URL data, so this subtree streams after a direct navigation
 * while the workspace-shaped App Shell is available immediately. Every lookup
 * behind it is cached by coherence domain in `api/cached-endpoints.ts`, which
 * also lets an intent-prefetched Link resolve this whole publication before the
 * click.
 */
async function WorkspacePublication({ searchParams }: PageProps) {
  const requested = parseWorkspaceState(getterFromRecord(await searchParams));
  const user = await getCachedCurrentUser("");
  const teams = await getCachedTeams(user.id);

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
    getCachedTasks(ctx, requested.filters),
    getCachedInsights(ctx),
    getCachedProjects(ctx),
    getCachedLabels(ctx),
    getCachedMembers(ctx),
    requested.selectedTaskId
      ? getCachedTask(ctx, requested.selectedTaskId)
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
    // `WorkspaceProvider` mounts the `LaneProvider`: the lane carries the
    // session as `loaderMeta`, and the session is what that component owns.
    <WorkspaceProvider initialUser={user} initialTeamId={teamId}>
      <LaneHydration snapshots={snapshots}>
        <Workspace />
      </LaneHydration>
    </WorkspaceProvider>
  );
}
