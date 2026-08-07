"use client";

import { useLane } from "use-lane";
import type { TaskPage, TaskScope } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import type { TaskPageFilters } from "../api/endpoints";
import { HybridTaskList } from "../hybrid-task-list";
import { derivePromise } from "../use-hybrid-infinite-lane";
import { publishedFirstPage } from "./published-first-page";

/**
 * The published variant, in three lines of difference from the prop form.
 *
 * `useLane` of an `external` read hands back a promise that resolves when the
 * publication lands — before it does, this component suspends and no request is
 * made. It resolves to a `LaneRead<TaskPage>`, and the list below takes a
 * `Promise<TaskPage>`, so the one thing this component does is map between them.
 *
 * **It maps through `derivePromise`, not inline.** `promise.then((r) => r.data)`
 * in render would hand the list a brand-new prop identity on every render, and
 * that identity is exactly what the interim wrapper downstream is keyed on. The
 * `WeakMap` gives one derived promise per publication, which is the right
 * granularity: a publication is a delivery, and a delivery is what the client
 * half counts.
 *
 * Nothing else differs. The list keeps the same key, the same version
 * comparison, and the same `lane.set` reset — the publication is only a
 * different delivery route for the same value, and this rig is what proves
 * delivery and convergence are independent concerns.
 */
export function PublishedTaskList({
  ctx,
  filters,
  scope,
}: {
  ctx: WorkspaceCtx;
  filters: TaskPageFilters;
  scope: TaskScope;
}) {
  const { promise } = useLane(publishedFirstPage(filters));
  const firstPagePromise = derivePromise(
    promise,
    (read): TaskPage => read.data,
  );

  return (
    <HybridTaskList
      ctx={ctx}
      firstPagePromise={firstPagePromise}
      scope={scope}
      source="publication"
    />
  );
}
