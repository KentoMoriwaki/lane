"use client";

import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/api/endpoints";
import {
  type WorkspaceUrlState,
  buildWorkspaceSearch,
  parseWorkspaceState,
} from "@/api/url-state";

type HistoryMode = "push" | "replace";

/**
 * Reads durable view state (filters, search, selected task) from the URL and
 * writes changes back with the native History API.
 *
 * Using `window.history` rather than the App Router keeps these
 * interaction-time updates from reloading Server Components: Next syncs
 * `useSearchParams`, the derived query key changes, and React Query serves the
 * cache or fetches. (Active-team changes are a route-identity change and are
 * handled by the workspace provider with App Router navigation instead.)
 */
export function useWorkspaceUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // searchParams is a stable string per navigation; key the parse off it.
  const searchString = searchParams.toString();

  const state = React.useMemo<WorkspaceUrlState>(
    () => parseWorkspaceState((key) => searchParams.get(key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchString],
  );

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const write = React.useCallback(
    (next: Partial<WorkspaceUrlState>, mode: HistoryMode) => {
      const merged: WorkspaceUrlState = { ...stateRef.current, ...next };
      const search = buildWorkspaceSearch(merged);
      const url = search ? `${pathname}?${search}` : pathname;
      if (mode === "push") {
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    },
    [pathname],
  );

  // Discrete filter/view actions push a history entry so Back returns to the
  // previous view. Continuous input (search typing) passes `mode: "replace"`
  // so it does not flood the history stack.
  const patchFilters = React.useCallback(
    (patch: Partial<TaskFilters>, mode: HistoryMode = "push") =>
      write({ filters: { ...stateRef.current.filters, ...patch } }, mode),
    [write],
  );

  // A view (sidebar item, insight card) replaces the filters but keeps the
  // active team and the currently open task.
  const applyView = React.useCallback(
    (view: Partial<TaskFilters>) =>
      write({ filters: { ...EMPTY_FILTERS, ...view } }, "push"),
    [write],
  );

  const resetFilters = React.useCallback(
    () => write({ filters: { ...EMPTY_FILTERS } }, "push"),
    [write],
  );

  // Opening/closing/switching a task pushes a history entry so Back closes the
  // detail panel — the behavior users expect.
  const selectTask = React.useCallback(
    (taskId: string | null) => write({ selectedTaskId: taskId }, "push"),
    [write],
  );

  return {
    teamId: state.teamId,
    filters: state.filters,
    selectedTaskId: state.selectedTaskId,
    patchFilters,
    applyView,
    resetFilters,
    selectTask,
  };
}
