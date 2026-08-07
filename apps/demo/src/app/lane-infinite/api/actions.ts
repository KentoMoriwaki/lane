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
 * expires the page-1 domain, and the route re-renders — so the client receives a
 * page 1 with a different `version`, which is a different key, which is a
 * different list. Nothing on the client observes the mutation; the key does the
 * work. See `api/lane-reads.ts`.
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
 * "Load page 1 again from the source" — the manual refresh, and the third of
 * the three cases the rig has to be able to produce separately:
 *
 * | trigger | cache | new `serveSeq` | new `version` |
 * | --- | --- | --- | --- |
 * | `router.refresh()` | warm | no | no |
 * | this action | expired | **yes** | no, if nothing changed |
 * | `createTaskAction` | expired | yes | **yes** |
 *
 * The middle row is the one worth having a button for: it is the only way to
 * hand the client a genuinely newer object describing identical content, which
 * is what proves the version — and not the object — is what decides whether the
 * user's depth survives.
 */
export async function refreshFirstPageAction(ctx: WorkspaceCtx): Promise<void> {
  updateTag(taskPageCacheTags.firstPage(ctx.teamId));
}
