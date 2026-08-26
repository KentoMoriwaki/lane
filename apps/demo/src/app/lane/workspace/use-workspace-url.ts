"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";
import {
  type WorkspaceUrlState,
  buildWorkspaceHref,
  parseWorkspaceState,
} from "@/app/lane/api/url-state";
import {
  ALL_WORKSPACE_CONTEXT,
  LANE_PATH,
  contextForKey,
  contextFromPathname,
  filtersForContext,
  filtersForContextUrl,
  legacyContextFromFilters,
  projectPath,
  type WorkspaceContextKey,
  type WorkspaceListContext,
} from "./workspace-context";

export { LANE_PATH, projectPath } from "./workspace-context";

type HistoryMode = "push" | "replace";

/** The path a task's own route has, panel or page — they are one URL. */
export function taskPath(taskId: string): string {
  return `${LANE_PATH}/task/${encodeURIComponent(taskId)}`;
}

const TASK_PATHNAME = /^\/lane\/task\/([^/]+)\/?$/;
const PRESENTATION_PARAMS = ["view", "group", "sort", "order"] as const;

function legacyContext(
  state: WorkspaceUrlState,
): WorkspaceListContext | null {
  const key = legacyContextFromFilters(state.filters);
  if (!key) return null;

  if (key === "project") {
    const projectId = state.filters.projectId;
    return projectId
      ? { key, pathname: projectPath(projectId), projectId }
      : null;
  }

  return contextForKey(key);
}

function routeContext(
  pathname: string,
  state: WorkspaceUrlState,
): WorkspaceListContext | null {
  const context = contextFromPathname(pathname);
  // Old shortcut URLs such as `/lane?scope=mine` remain readable and become
  // canonical the next time search or a Context link writes the URL.
  return context?.key === "all" ? legacyContext(state) ?? context : context;
}

function stateForContext(
  state: WorkspaceUrlState,
  context: WorkspaceListContext,
): WorkspaceUrlState {
  return { ...state, filters: filtersForContext(state.filters, context) };
}

function stateForListUrl(state: WorkspaceUrlState): WorkspaceUrlState {
  return { ...state, filters: filtersForContextUrl(state.filters) };
}

function withPresentation(
  href: string,
  source: URLSearchParams,
): string {
  const url = new URL(href, "http://lane.local");
  for (const key of PRESENTATION_PARAMS) {
    const value = source.get(key);
    if (value) url.searchParams.set(key, value);
  }
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}

/**
 * **The open task, read from the route rather than from a query parameter.**
 *
 * A row navigates to the task's canonical path. The intercepted panel keeps
 * the list tree alive, while a direct visit renders the independent task page.
 */
export function useSelectedTaskId(): string | null {
  const pathname = usePathname();
  const match = TASK_PATHNAME.exec(pathname);

  return match ? decodeURIComponent(match[1]) : null;
}

export function useWorkspaceUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const [isPending, startTransition] = React.useTransition();

  const parsed = React.useMemo<WorkspaceUrlState>(() => {
    const params = new URLSearchParams(searchString);
    return parseWorkspaceState((key) => params.get(key));
  }, [searchString]);
  const currentRouteContext = React.useMemo(
    () => routeContext(pathname, parsed),
    [parsed, pathname],
  );
  // While a task panel is open `usePathname()` names the task. The list tree is
  // still mounted, so each of its controls remembers the Context it had before
  // the interception. A directly loaded task page has no such memory and falls
  // back to the all-workspace Context.
  const contextRef = React.useRef(
    currentRouteContext ?? ALL_WORKSPACE_CONTEXT,
  );
  const listStateRef = React.useRef(parsed);
  const listSearchRef = React.useRef(searchString);
  if (currentRouteContext) {
    contextRef.current = currentRouteContext;
    listStateRef.current = parsed;
    listSearchRef.current = searchString;
  }
  const context = currentRouteContext ?? contextRef.current;
  const listState = currentRouteContext ? parsed : listStateRef.current;
  const listSearchString = currentRouteContext
    ? searchString
    : listSearchRef.current;

  const state = React.useMemo<WorkspaceUrlState>(
    () => stateForContext(listState, context),
    [context, listState],
  );

  const readCurrent = React.useCallback((): {
    context: WorkspaceListContext;
    params: URLSearchParams;
    state: WorkspaceUrlState;
  } => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseWorkspaceState((key) => params.get(key));
    const currentRouteContext = routeContext(window.location.pathname, parsed);
    const context = currentRouteContext ?? contextRef.current;
    const state = currentRouteContext ? parsed : listStateRef.current;
    const presentationParams = currentRouteContext
      ? params
      : new URLSearchParams(listSearchRef.current);

    return {
      context,
      params: presentationParams,
      state: stateForContext(state, context),
    };
  }, []);

  // Search is the sole refinement outside the named Context. It uses replace
  // so typing does not fill browser history, and it preserves Group/Sort since
  // those describe the same list rather than a new server query.
  const write = React.useCallback(
    (next: Partial<WorkspaceUrlState>, mode: HistoryMode) => {
      const current = readCurrent();
      const merged = { ...current.state, ...next };
      const href = withPresentation(
        buildWorkspaceHref(
          current.context.pathname,
          stateForListUrl(merged),
          {},
        ),
        current.params,
      );
      startTransition(() => {
        if (mode === "push") {
          router.push(href, { scroll: false });
        } else {
          router.replace(href, { scroll: false });
        }
      });
    },
    [readCurrent, router],
  );

  const patchFilters = React.useCallback(
    (patch: Partial<TaskFilters>, mode: HistoryMode = "push") =>
      write({ filters: { ...readCurrent().state.filters, ...patch } }, mode),
    [readCurrent, write],
  );

  const resetFilters = React.useCallback(
    () => write({ filters: { ...EMPTY_FILTERS } }, "push"),
    [write],
  );

  // A task URL names only the task (plus the active team when it is not the
  // default). The list Context and its presentation stay in browser history.
  const taskHref = React.useCallback(
    (taskId: string) =>
      buildWorkspaceHref(
        taskPath(taskId),
        { ...state, filters: EMPTY_FILTERS, selectedTaskId: null },
        {},
      ),
    [state],
  );

  const listHref = React.useMemo(
    () =>
      withPresentation(
        buildWorkspaceHref(context.pathname, stateForListUrl(state), {}),
        new URLSearchParams(listSearchString),
      ),
    [context.pathname, listSearchString, state],
  );

  const contextHref = React.useCallback(
    (target: WorkspaceListContext) =>
      withPresentation(
        buildWorkspaceHref(target.pathname, stateForListUrl(state), {}),
        new URLSearchParams(listSearchString),
      ),
    [listSearchString, state],
  );

  /** Leave a deleted task without adding another history entry. */
  const closeTask = React.useCallback(() => {
    const current = readCurrent();
    const href = withPresentation(
      buildWorkspaceHref(
        current.context.pathname,
        stateForListUrl(current.state),
        {},
      ),
      current.params,
    );
    startTransition(() => router.replace(href, { scroll: false }));
  }, [readCurrent, router]);

  return {
    state,
    teamId: state.teamId,
    filters: state.filters,
    contextKey: context.key as WorkspaceContextKey,
    contextPathname: context.pathname,
    fixedProjectId: context.projectId,
    isPending,
    listHref,
    taskHref,
    contextHref,
    closeTask,
    patchFilters,
    resetFilters,
  };
}
