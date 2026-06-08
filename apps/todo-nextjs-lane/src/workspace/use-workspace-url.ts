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

export function useWorkspaceUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const [isPending, startTransition] = React.useTransition();

  const state = React.useMemo<WorkspaceUrlState>(
    () => {
      const params = new URLSearchParams(searchString);
      return parseWorkspaceState((key) => params.get(key));
    },
    [searchString],
  );

  const write = React.useCallback(
    (next: Partial<WorkspaceUrlState>, mode: HistoryMode) => {
      const merged: WorkspaceUrlState = { ...state, ...next };
      const search = buildWorkspaceSearch(merged);
      const url = search ? `${pathname}?${search}` : pathname;
      startTransition(() => {
        if (mode === "push") {
          window.history.pushState(null, "", url);
        } else {
          window.history.replaceState(null, "", url);
        }
      });
    },
    [pathname, startTransition, state],
  );

  // Discrete filter/view actions push a history entry so Back returns to the
  // previous view. Continuous input (search typing) passes `mode: "replace"`
  // so it does not flood the history stack.
  const patchFilters = React.useCallback(
    (patch: Partial<TaskFilters>, mode: HistoryMode = "push") =>
      write({ filters: { ...state.filters, ...patch } }, mode),
    [state.filters, write],
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
    isPending,
    selectedTaskId: state.selectedTaskId,
    patchFilters,
    applyView,
    resetFilters,
    selectTask,
  };
}
