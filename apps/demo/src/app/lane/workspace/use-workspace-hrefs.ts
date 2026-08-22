"use client";

import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import { buildWorkspaceHref } from "@/app/lane/api/url-state";
import { useWorkspaceUrl } from "./use-workspace-url";

/**
 * The links a region needs, built where the region lives.
 *
 * The frame used to compute these and thread them down. It cannot any more: the
 * regions are rendered on the server now, and a function is not something that
 * crosses that boundary. Every input is in the URL, which each client leaf can
 * read for itself, so the threading was never carrying anything the leaf did
 * not already have access to.
 */
export function useWorkspaceHrefs() {
  const { pathname, state, filters } = useWorkspaceUrl();

  const viewHref = React.useCallback(
    (view: Partial<TaskFilters>) =>
      buildWorkspaceHref(pathname, state, {
        filters: { ...EMPTY_FILTERS, ...view },
      }),
    [pathname, state],
  );

  const filterHref = React.useCallback(
    (nextFilters: TaskFilters) =>
      buildWorkspaceHref(pathname, state, { filters: nextFilters }),
    [pathname, state],
  );

  const resetFiltersHref = React.useMemo(
    () =>
      buildWorkspaceHref(pathname, state, { filters: { ...EMPTY_FILTERS } }),
    [pathname, state],
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
