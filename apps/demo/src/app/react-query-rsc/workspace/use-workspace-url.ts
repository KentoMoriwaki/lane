"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/react-query-rsc/api/endpoints";
import {
  type WorkspaceUrlState,
  buildWorkspaceSearch,
  parseWorkspaceState,
} from "@/app/react-query-rsc/api/url-state";

type HistoryMode = "push" | "replace";

/**
 * Reads durable view state (filters, search, selected task) from the URL and
 * writes changes back with the native History API.
 *
 * Filter changes use `window.history` so React Query can serve or fetch the new
 * key without reloading Server Components. Task selection uses the App Router
 * because its detail belongs in the dehydrated generation; active-team changes
 * are likewise handled as route identity in the workspace provider.
 */
export function useWorkspaceUrl() {
  const pathname = usePathname();
  const router = useRouter();
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
  // detail panel — the behavior users expect. This one uses the App Router so
  // a newly created task's detail also arrives through server dehydration;
  // filter-only changes remain ordinary client Query transitions above.
  const selectTask = React.useCallback(
    (taskId: string | null) => {
      const state = { ...stateRef.current, selectedTaskId: taskId };
      const search = buildWorkspaceSearch(state);
      router.push(search ? `${pathname}?${search}` : pathname);
    },
    [pathname, router],
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
