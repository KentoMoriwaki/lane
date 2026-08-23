import type { TaskPage, TaskScope } from "@/server/api";
import { assertOk, client, requestOptions } from "@/app/lane/api/client";
import type { WorkspaceCtx } from "@/lib/lane-meta";

/**
 * The one fetch this spike has, called from **both** halves of the route.
 *
 * That is the constraint the hybrid pattern is built on: the value the Server
 * Component publishes for page 1 must be byte-identical in *shape* to what the
 * browser's `fetchPage` returns for pages 2..N, because they end up in the same
 * `pages: P[]` array. Sharing the function rather than the shape is the only
 * way to keep that true as the endpoint changes.
 */

export const TASK_PAGE_SIZE = 4;

export type TaskPageFilters = {
  scope: TaskScope;
};

export const DEFAULT_TASK_PAGE_FILTERS: TaskPageFilters = { scope: "all" };

export function parseTaskPageScope(value: string | null | undefined): TaskScope {
  return value === "mine" || value === "unassigned" ? value : "all";
}

export async function fetchTaskPage(
  ctx: WorkspaceCtx,
  filters: TaskPageFilters,
  page: { cursor: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<TaskPage> {
  const query: Record<string, string> = {
    limit: String(page.limit ?? TASK_PAGE_SIZE),
  };
  if (page.cursor) query.cursor = page.cursor;
  if (filters.scope !== "all") query.scope = filters.scope;

  const options = requestOptions(ctx);
  const response = await client.api["task-pages"].$get(
    { query },
    { ...options, init: { ...options.init, signal } },
  );
  await assertOk(response);
  return (await response.json()) as TaskPage;
}
