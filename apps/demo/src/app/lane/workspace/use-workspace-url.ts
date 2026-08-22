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

/** The list route. Filters and the team live in its query string. */
export const LANE_PATH = "/lane";

/** The path a task's own route has, panel or page — they are one URL. */
export function taskPath(taskId: string): string {
  return `${LANE_PATH}/task/${encodeURIComponent(taskId)}`;
}

const TASK_PATHNAME = /^\/lane\/task\/([^/]+)\/?$/;

/**
 * **The open task, read from the route rather than from a query parameter.**
 *
 * It used to be `?task=<id>` on the list route. It is a path now, and that path
 * means two different renders — the intercepted panel when a `<Link>` brought
 * the user here, the full page on a direct visit — so the *pathname* is the one
 * thing both have in common, and it is what the list highlights against.
 *
 * `useParams()` is not used for this on purpose: while the panel is open the
 * list sits in a slot that has no `[id]` of its own, and what it needs to know
 * is what the URL says, not what its own segment matched.
 */
export function useSelectedTaskId(): string | null {
  const pathname = usePathname();
  const match = TASK_PATHNAME.exec(pathname);

  return match ? decodeURIComponent(match[1]) : null;
}

export function useWorkspaceUrl() {
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

  // A debounced search commit fires a few hundred milliseconds after the
  // keystroke that scheduled it, by which time a link navigation may already
  // have changed the view. Writes therefore merge onto the URL as it is at write
  // time, not onto a render-time snapshot captured in a closure: a late commit
  // can only lose `q` to a newer value instead of restoring the whole previous
  // filter set. Reading `window.location` keeps this out of render, where a
  // mirrored ref would be written by renders that never commit.
  const readCurrentState = React.useCallback((): WorkspaceUrlState => {
    const params = new URLSearchParams(window.location.search);
    return parseWorkspaceState((key) => params.get(key));
  }, []);

  // Every filter write targets the list route, never the pathname it was called
  // from. A filter changed with the panel open belongs to the list, and landing
  // on `/lane` is also what closes the panel — the slot matches nothing there.
  const write = React.useCallback(
    (next: Partial<WorkspaceUrlState>, mode: HistoryMode) => {
      const href = buildWorkspaceHref(LANE_PATH, readCurrentState(), next);
      startTransition(() => {
        if (mode === "push") {
          router.push(href, { scroll: false });
        } else {
          router.replace(href, { scroll: false });
        }
      });
    },
    [readCurrentState, router, startTransition],
  );

  // Discrete filter/view actions push a history entry so Back returns to the
  // previous view. Continuous input (search typing) passes `mode: "replace"`
  // so it does not flood the history stack.
  const patchFilters = React.useCallback(
    (patch: Partial<TaskFilters>, mode: HistoryMode = "push") =>
      write({ filters: { ...readCurrentState().filters, ...patch } }, mode),
    [readCurrentState, write],
  );

  const resetFilters = React.useCallback(
    () => write({ filters: { ...EMPTY_FILTERS } }, "push"),
    [write],
  );

  // The task links, with the view carried along: the filters and the team stay
  // in the query string across the navigation, so the list behind an
  // intercepted panel keeps reading the very key it was published under, and
  // the back link restores the view the user left.
  const taskHref = React.useCallback(
    (taskId: string) => buildWorkspaceHref(taskPath(taskId), state, {}),
    [state],
  );

  const listHref = React.useMemo(
    () => buildWorkspaceHref(LANE_PATH, state, {}),
    [state],
  );

  /** Leave the detail without adding a history entry — used after a delete. */
  const closeTask = React.useCallback(() => {
    const href = buildWorkspaceHref(LANE_PATH, readCurrentState(), {});
    startTransition(() => router.replace(href, { scroll: false }));
  }, [readCurrentState, router, startTransition]);

  return {
    state,
    teamId: state.teamId,
    filters: state.filters,
    isPending,
    listHref,
    taskHref,
    closeTask,
    patchFilters,
    resetFilters,
  };
}
