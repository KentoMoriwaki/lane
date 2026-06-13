"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import {
  type WorkspaceUrlState,
  buildWorkspaceHref,
  parseWorkspaceState,
} from "@/app/lane/api/url-state";

type HistoryMode = "push" | "replace";

export function useWorkspaceUrl() {
  const pathname = usePathname();
  const router = useRouter();
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
      const href = buildWorkspaceHref(pathname, state, next);
      startTransition(() => {
        if (mode === "push") {
          router.push(href, { scroll: false });
        } else {
          router.replace(href, { scroll: false });
        }
      });
    },
    [pathname, router, startTransition, state],
  );

  // Discrete filter/view actions push a history entry so Back returns to the
  // previous view. Continuous input (search typing) passes `mode: "replace"`
  // so it does not flood the history stack.
  const patchFilters = React.useCallback(
    (patch: Partial<TaskFilters>, mode: HistoryMode = "push") =>
      write({ filters: { ...state.filters, ...patch } }, mode),
    [state.filters, write],
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
    pathname,
    state,
    teamId: state.teamId,
    filters: state.filters,
    isPending,
    selectedTaskId: state.selectedTaskId,
    patchFilters,
    resetFilters,
    selectTask,
  };
}
