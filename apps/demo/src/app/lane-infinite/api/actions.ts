"use server";

import { updateTag } from "next/cache";
import type { Task } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { createTask } from "@/app/lane/api/endpoints";
import { taskPageCacheTags } from "./cached-endpoints";

/**
 * The republication trigger.
 *
 * A create is the interesting mutation for this spike because it changes the
 * *contents of page 1* and therefore every cursor below it. The action mutates,
 * expires the page-1 domain, and the route re-renders — which republishes the
 * external key with a new promise identity and a new `servedAt`. The client's
 * job from there is to notice and re-walk; see `hybrid-task-list.tsx`.
 */
export async function createTaskAction(
  ctx: WorkspaceCtx,
  title: string,
): Promise<Task> {
  const task = await createTask(ctx, {
    priority: "urgent",
    status: "in_progress",
    title,
  });
  updateTag(taskPageCacheTags.firstPage(ctx.teamId));
  return task;
}

/**
 * "Publish again, with fresh data" — the manual version of the same channel.
 * Expiring the tag is what separates it from a bare `router.refresh()`, which
 * republishes the *cached* page (same `servedAt`) and is worth being able to
 * trigger separately: it isolates "the publication's identity changed" from
 * "the publication's contents changed".
 */
export async function refreshFirstPageAction(ctx: WorkspaceCtx): Promise<void> {
  updateTag(taskPageCacheTags.firstPage(ctx.teamId));
}
