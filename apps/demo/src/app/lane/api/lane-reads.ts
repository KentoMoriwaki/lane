import {
  external,
  infiniteLaneRead,
  infiniteLaneSnapshot,
  laneRead,
  laneSnapshot,
} from "use-lane";
import type { LaneHydrationSnapshots, LaneSnapshot } from "use-lane";
import type {
  CurrentUser,
  Insights,
  Task,
  TaskPage,
  TeamLabel,
  TeamMember,
  TeamSummary,
} from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { fetchTaskPage, type ProjectTaskCounts, type TaskFilters } from "./endpoints";
import type { ProjectRef } from "./route-reads";

/**
 * Every read this workspace performs, defined once — and every one of them is
 * `external`: **this client does not fetch its workspace.** The route seeds these
 * keys from the server on every render (see `workspaceSnapshots` below and
 * `page.tsx`), and `external` is how a read says so — a real loader that waits
 * for the publication instead of going after the data itself.
 *
 * The freshness options are gone with the loaders, and their absence is the
 * point rather than an omission: `staleTime`, `gcTime`, `refetchOnFocus` and
 * `refetchOnMount` are all instructions to a fetcher this read does not have.
 * Freshness here is the server's to decide, and it decides it the same way it
 * decides everything else — by publishing. The type will not even let these
 * reads carry the options (the external spec has no room for them), which is
 * what keeps "server-owned" from quietly eroding one option at a time.
 *
 * `T` has to be written out for the same reason: nothing is inferred from a
 * loader that never loads. It is the one cost of the form, and it is paid once,
 * here.
 *
 * What is worth noticing is what is **not** here: a second map of keys. Each
 * factory takes exactly what decides its key — `tasks(filters)`, `task(taskId)` —
 * and the session the loaders need arrives from the lane as `meta` (declared in
 * `@/lib/lane-meta`, supplied by `WorkspaceProvider`). So a read is a plain
 * object that costs nothing to build, and `.key` is reachable from anywhere:
 *
 * ```ts
 * laneSnapshot(workspaceReads.insights(), insights);  // the server publishes
 * useLane(workspaceReads.insights());                 // the client reads
 * lane.invalidate(workspaceReads.insights().key);     // the client marks stale
 * ```
 *
 * The third line is a write, and there is nothing special about it: a published
 * key takes `set` / `update` / `invalidate` like any other. What "server-owned"
 * means is not that the client may not write — it is that the client has no
 * freshness policy of its own here. It can say *this value is what came back*
 * and *this key is stale*; deciding when to load again is the owner's, and the
 * answer always arrives as a publication (see `api/hooks.ts`).
 *
 * Note there is no `"use client"` on this module, and both graphs import it: the
 * components read in the browser, while `page.tsx` — a Server Component — calls
 * `workspaceSnapshots` to seed the very same entries. `laneRead` and
 * `laneSnapshot` are isomorphic and never call a loader, so building a read on
 * the server costs one object.
 *
 * Team-owned keys omit `teamId`: the active team travels in request headers, so
 * switching teams does not rename a single key. It does not have to — a switch
 * is a navigation, the route re-renders for the new team, and the publication
 * that follows overwrites every one of these keys. The client-owned variants
 * have to evict them by hand; here the same event that changes the team is the
 * one that republishes them.
 */
/**
 * The context for a caller that will never make the call: the route building
 * `workspaceReads.tasks(filters)` for its key. Empty ids are what this API
 * reads as "apply your defaults", and nothing on the server ever reaches the
 * `fetchPage` they would travel on.
 */
const NOT_THE_BROWSER: WorkspaceCtx = { teamId: "", userId: "" };

export const workspaceReads = {
  currentUser: () =>
    laneRead<CurrentUser>({ key: ["current-user"], loader: external }),
  teams: () => laneRead<TeamSummary[]>({ key: ["teams"], loader: external }),
  /**
   * **The list whose first page is the route's and whose depth is the
   * browser's**, on one key.
   *
   * `loader: external` says page 1 is published, exactly as on every other read
   * here; `fetchPage` and `nextCursor` are the browser's half, and they are the
   * only client fetch anywhere in this workspace's reads. The key holds
   * `{ pages, params, hasNext }` whoever filled it, and `infiniteLaneSnapshot`
   * (in `workspaceSnapshots` below) is the one place a page becomes that shape.
   *
   * A page is `{ items, nextCursor }` — the endpoint's own envelope — rather
   * than a bare `Task[]`, so "where the next page starts" travels with the rows
   * it was computed from and `nextCursor(page)` is a field read, not a guess.
   *
   * What a republication does to the depth is the library's rule, not this
   * app's: an equal page 1 keeps the pages standing behind it, a different one
   * (or an `invalidate`) resets to one page. See `docs/api-reference.md` §
   * `useInfiniteLane` → "The first page from the route", and `api/hooks.ts` for
   * which mutation does which.
   *
   * `ctx` is the one argument here that is not part of the key, because it is
   * not part of the value either — it is who the *browser* says it is when it
   * asks for page 2, and the team it asks about has to be the team the route
   * published page 1 for. The hook passes `useWorkspaceCtx()`; the route's own
   * callers build this read for its `key` and `nextCursor` alone and leave it
   * out. (It cannot ride on `read.loaderMeta`, the documented per-read
   * override: the external infinite spec carries no `LaneUseOptions`.)
   */
  tasks: (filters: TaskFilters, ctx: WorkspaceCtx = NOT_THE_BROWSER) =>
    infiniteLaneRead<TaskPage, string | null>({
      key: ["tasks", filters],
      loader: external,
      fetchPage: (cursor) => fetchTaskPage(ctx, filters, { cursor }),
      nextCursor: (page) => page.nextCursor,
    }),
  task: (taskId: string) =>
    laneRead<Task>({ key: ["task", taskId], loader: external }),
  projects: () =>
    laneRead<ProjectRef[]>({ key: ["projects"], loader: external }),
  // Its own key so a task mutation can publish the confirmed derived counts
  // without replacing the project roster beside them.
  projectCounts: () =>
    laneRead<ProjectTaskCounts>({ key: ["project-counts"], loader: external }),
  labels: () => laneRead<TeamLabel[]>({ key: ["labels"], loader: external }),
  members: () => laneRead<TeamMember[]>({ key: ["members"], loader: external }),
  insights: () => laneRead<Insights>({ key: ["insights"], loader: external }),
};

/**
 * The seeds each region publishes.
 *
 * There is no whole-workspace bundle any more. A region publishes exactly the
 * keys its leaf reads, and `<LaneHydration>` boundaries nest, so a leaf still
 * sees every key seeded anywhere in its lineage. `laneSnapshot` takes the read
 * itself, so the entry a snapshot names cannot drift from the entry that loads
 * it, and `data` is checked against what that read loads.
 */
export const workspaceSnapshots = {
  /**
   * The list route's reference data, published in one place.
   *
   * It is more than the sidebar draws, and deliberately so: the create dialog
   * lives in the frame, which is not a region and publishes nothing, and its
   * three pickers read members, projects, the counts and labels. The detail
   * used to publish those as a region of this route; it is its own route now,
   * so the list route has to carry them itself or the pickers wait for a
   * publication that never comes. They are all dynamic route reads; publishing
   * them here is about reachability, not persistent data caching.
   */
  sidebar(seeds: {
    currentUser: CurrentUser;
    teams: TeamSummary[];
    insights: Insights;
    projects: ProjectRef[];
    projectCounts: ProjectTaskCounts;
    labels: TeamLabel[];
    members: TeamMember[];
  }): LaneHydrationSnapshots {
    return {
      entries: [
        laneSnapshot(workspaceReads.currentUser(), seeds.currentUser),
        laneSnapshot(workspaceReads.teams(), seeds.teams),
        laneSnapshot(workspaceReads.insights(), seeds.insights),
        laneSnapshot(workspaceReads.projects(), seeds.projects),
        laneSnapshot(workspaceReads.projectCounts(), seeds.projectCounts),
        laneSnapshot(workspaceReads.labels(), seeds.labels),
        laneSnapshot(workspaceReads.members(), seeds.members),
      ],
    };
  },

  insights(insights: Insights): LaneHydrationSnapshots {
    return { entries: [laneSnapshot(workspaceReads.insights(), insights)] };
  },

  /**
   * The list's first page, published as the list.
   *
   * The key holds `{ pages, params, hasNext }` however deep the browser has
   * taken it, so the route has to publish that shape — and
   * `infiniteLaneSnapshot` is **the only place in this app where a page becomes
   * it**. `null` is the cursor page 1 was fetched with, recorded so a re-read
   * starts where this one did; `hasNext` comes from the read's own `nextCursor`
   * applied to the page, so the route and the browser agree there is more
   * before a single client fetch has run.
   *
   * What lands on top of a browser that has already loaded page 2 is the
   * library's business, not this file's: an equal page 1 keeps the depth
   * (`docs/api-reference.md` § "The first page from the route").
   */
  tasks(seeds: {
    filters: TaskFilters;
    data: TaskPage;
  }): LaneHydrationSnapshots {
    return {
      entries: [
        infiniteLaneSnapshot(
          workspaceReads.tasks(seeds.filters),
          seeds.data,
          null,
        ),
      ],
    };
  },

  filterBar(seeds: {
    projects: ProjectRef[];
    labels: TeamLabel[];
    tasks: { filters: TaskFilters; data: TaskPage };
  }): LaneHydrationSnapshots {
    return {
      entries: [
        laneSnapshot(workspaceReads.projects(), seeds.projects),
        laneSnapshot(workspaceReads.labels(), seeds.labels),
        infiniteLaneSnapshot(
          workspaceReads.tasks(seeds.tasks.filters),
          seeds.tasks.data,
          null,
        ),
      ],
    };
  },

  /**
   * The detail's keys, published by whichever route is showing it — the task
   * page or its intercepted twin in the panel slot. Both publish the same
   * entries, so `useTask(id)` reads one key however the detail was opened.
   */
  detail(seeds: {
    members: TeamMember[];
    projects: ProjectRef[];
    /**
     * Only the page surface passes these. In the panel the sidebar is on
     * screen and has already published them, and the count is the one
     * dynamic read of the four — asking for it twice in one render would be
     * two trips to the source for one number.
     */
    projectCounts?: ProjectTaskCounts;
    labels: TeamLabel[];
    task: Task;
  }): LaneHydrationSnapshots {
    const entries: LaneSnapshot[] = [
      laneSnapshot(workspaceReads.members(), seeds.members),
      laneSnapshot(workspaceReads.projects(), seeds.projects),
      laneSnapshot(workspaceReads.labels(), seeds.labels),
      laneSnapshot(workspaceReads.task(seeds.task.id), seeds.task),
    ];

    if (seeds.projectCounts) {
      entries.push(
        laneSnapshot(workspaceReads.projectCounts(), seeds.projectCounts),
      );
    }

    return { entries };
  },
};
