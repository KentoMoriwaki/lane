"use client";

import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import { buildWorkspaceHref } from "@/app/lane/api/url-state";
import { LANE_PATH, useWorkspaceUrl } from "./use-workspace-url";

/**
 * The links a region needs, built where the region lives.
 *
 * The frame used to compute these and thread them down. It cannot any more: the
 * regions are rendered on the server now, and a function is not something that
 * crosses that boundary. Every input is in the URL, which each client leaf can
 * read for itself, so the threading was never carrying anything the leaf did
 * not already have access to.
 *
 * They all point at `LANE_PATH`, never at the current pathname. A view is a
 * property of the list, so choosing one while the panel is open navigates to
 * the list showing it — which closes the panel, because the slot matches
 * nothing at `/lane`.
 */
export function useWorkspaceHrefs() {
  const { state, filters } = useWorkspaceUrl();

  const viewHref = React.useCallback(
    (view: Partial<TaskFilters>) =>
      buildWorkspaceHref(LANE_PATH, state, {
        filters: { ...EMPTY_FILTERS, ...view },
      }),
    [state],
  );

  const filterHref = React.useCallback(
    (nextFilters: TaskFilters) =>
      buildWorkspaceHref(LANE_PATH, state, { filters: nextFilters }),
    [state],
  );

  const resetFiltersHref = React.useMemo(
    () =>
      buildWorkspaceHref(LANE_PATH, state, { filters: { ...EMPTY_FILTERS } }),
    [state],
  );

  return { filters, viewHref, filterHref, resetFiltersHref };
}

export function hasActiveFilters(filters: TaskFilters): boolean {
  return (
    filters.scope !== "all" ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    Boolean(filters.projectId) ||
    Boolean(filters.labelId) ||
    Boolean(filters.due) ||
    filters.q.trim().length > 0
  );
}
