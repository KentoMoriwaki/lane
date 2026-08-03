"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import {
  buildWorkspaceHref,
  parseWorkspaceState,
  type WorkspaceUrlState,
} from "@/app/lane/api/url-state";

type HistoryMode = "push" | "replace";

/** URL state is shared as a pure contract; navigation behavior stays local. */
export function useWorkspaceUrl() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const [isPending, startTransition] = React.useTransition();

  const state = React.useMemo<WorkspaceUrlState>(() => {
    const params = new URLSearchParams(searchString);
    return parseWorkspaceState((key) => params.get(key));
  }, [searchString]);

  const readCurrentState = React.useCallback((): WorkspaceUrlState => {
    const params = new URLSearchParams(window.location.search);
    return parseWorkspaceState((key) => params.get(key));
  }, []);

  const write = React.useCallback(
    (next: Partial<WorkspaceUrlState>, mode: HistoryMode) => {
      const href = buildWorkspaceHref(pathname, readCurrentState(), next);
      startTransition(() => {
        if (mode === "push") router.push(href, { scroll: false });
        else router.replace(href, { scroll: false });
      });
    },
    [pathname, readCurrentState, router],
  );

  const patchFilters = React.useCallback(
    (patch: Partial<TaskFilters>, mode: HistoryMode = "push") =>
      write({ filters: { ...readCurrentState().filters, ...patch } }, mode),
    [readCurrentState, write],
  );

  const resetFilters = React.useCallback(
    () => write({ filters: { ...EMPTY_FILTERS } }, "push"),
    [write],
  );

  const selectTask = React.useCallback(
    (taskId: string | null) => write({ selectedTaskId: taskId }, "push"),
    [write],
  );

  return {
    pathname,
    state,
    filters: state.filters,
    selectedTaskId: state.selectedTaskId,
    isPending,
    patchFilters,
    resetFilters,
    selectTask,
  };
}
