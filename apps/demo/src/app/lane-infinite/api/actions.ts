"use server";

import { revalidateTag, updateTag } from "next/cache";
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

/**
 * **The same insert, delivered differently.** Two variants that mutate exactly
 * as `createTaskAction` does and then reach for the *other* revalidation verbs,
 * so the three can be compared in one session against one rig.
 *
 * The question they exist to answer is not about caching. It is about ownership:
 * Lane forbids a client write to a published key because a republication could
 * land at any moment and silently clobber it. That argument assumes revalidation
 * always *delivers*. If `revalidateTag(tag, "max")` really only marks — with the
 * fresh payload deferred to the next natural read — then there is a window in
 * which the server's truth has moved, the client holds the action's return
 * value, and no publication is coming yet. Whether that window is real is what
 * `apps/demo`'s frame recorder measures.
 */
export async function createTaskDeferredAction(
  ctx: WorkspaceCtx,
  title: string,
): Promise<Task> {
  const task = await createTask(ctx, {
    priority: "urgent",
    status: "in_progress",
    title,
  });
  // Mark-only, per the docs: stale-while-revalidate, delivery deferred to the
  // next visit of a page carrying the tag.
  revalidateTag(taskPageCacheTags.firstPage(ctx.teamId), "max");
  return task;
}

/** The webhook-grade spelling the docs point at for immediate expiry. */
export async function createTaskExpireZeroAction(
  ctx: WorkspaceCtx,
  title: string,
): Promise<Task> {
  const task = await createTask(ctx, {
    priority: "urgent",
    status: "in_progress",
    title,
  });
  revalidateTag(taskPageCacheTags.firstPage(ctx.teamId), { expire: 0 });
  return task;
}
