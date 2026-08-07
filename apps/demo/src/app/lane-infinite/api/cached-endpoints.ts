import { cacheLife, cacheTag } from "next/cache";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { fetchCurrentUser } from "@/app/lane/api/endpoints";
import { fetchTaskPage, type TaskPageFilters } from "./endpoints";

/**
 * Next owns freshness on the server half; Lane publishes the result. One tag,
 * because this route reads one thing: page 1 of the task list. A mutation
 * expires it, the route re-renders, and the publication is the patch.
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
 * The cache is what makes the spike's `servedAt` stamp meaningful: a
 * republication that did *not* expire this tag re-publishes the same page
 * object (same `servedAt`), and one that did expire it publishes a page with a
 * new stamp. Which of those the client's re-walk ends up holding is exactly the
 * closure-freshness question.
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
