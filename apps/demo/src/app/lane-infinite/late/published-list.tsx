"use client";

import * as React from "react";
import { useLane } from "use-lane";
import type { TaskScope } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import type { TaskPageFilters } from "../api/endpoints";
import { HybridTaskList } from "../hybrid-task-list";
import { publishedFirstPage } from "./published-first-page";

/**
 * The published variant, in four lines of difference from the prop form.
 *
 * `useLane` of an `external` read hands back a promise that resolves when the
 * publication lands — before it does, this component suspends and no request is
 * made. `use()` turns that into the same `TaskPage` value the prop form gets,
 * and everything downstream is byte-for-byte the main rig.
 *
 * The republication path collapses into the same mechanism too, which is the
 * result worth having: a publication settles this read immediately (it is
 * replaced, not refetched), so `data` is a new value in that same commit, and
 * `firstPage` decides from its `version` whether that is a new list or the one
 * already on screen — no effect, no promise identity to watch, no ref guard. The
 * first revision of this spike chained the infinite loader onto
 * `externalPromise.then((r) => r.data)` and reconciled with an effect;
 * unwrapping here instead means the published form and the prop form are one
 * pattern with one convergence rule.
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
  const { data } = React.use(promise);

  return (
    <HybridTaskList
      ctx={ctx}
      firstPage={data}
      scope={scope}
      source="publication"
    />
  );
}
