import { cacheLife, cacheTag } from "next/cache";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { fetchCurrentUser } from "@/app/lane/api/endpoints";
import { fetchTaskPage, type TaskPageFilters } from "./endpoints";

/**
 * Next owns freshness on the server half. One tag, because this route reads one
 * thing: page 1 of the task list. A mutation expires it, the route re-renders,
 * and the new page reaches the browser as a prop.
 */
export const taskPageCacheTags = {
  currentUser: () => "lane-infinite:current-user",
  firstPage: (teamId: string) => `lane-infinite:first-page:${teamId}`,
};

export async function getCachedCurrentUser(userId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(taskPageCacheTags.currentUser());

  return fetchCurrentUser({ teamId: "", userId });
}

/**
 * Page 1, cached by coherence domain.
 *
 * The cache is what lets the rig separate the three republication cases (see
 * `actions.ts`). A `router.refresh()` over a warm entry hands back the very same
 * page — same `version`, same `serveSeq` — and the client should not so much as
 * blink. Expiring the tag produces a new serve of the same rows: new `serveSeq`,
 * same `version`, and the client should *still* not blink, which is the whole
 * claim the content hash exists to make good on.
 */
export async function getCachedFirstTaskPage(
  ctx: WorkspaceCtx,
  filters: TaskPageFilters,
) {
  "use cache";
  cacheLife("max");
  cacheTag(taskPageCacheTags.firstPage(ctx.teamId));

  return fetchTaskPage(ctx, filters, { cursor: null });
}
