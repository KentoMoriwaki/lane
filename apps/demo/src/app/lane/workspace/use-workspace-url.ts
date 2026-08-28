"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  type WorkspaceUrlState,
  buildWorkspaceHref,
  parseWorkspaceState,
} from "@/app/lane/api/url-state";
import {
  ALL_WORKSPACE_CONTEXT,
  TASKS_PATH,
  contextFromPathname,
  filtersForContext,
  filtersForContextUrl,
  type WorkspaceListContext,
  WORKSPACE_PRESENTATION_PARAMS,
} from "./workspace-context";

/** A task has one canonical identity, independent of the list behind it. */
function taskPath(taskId: string): string {
  return `${TASKS_PATH}/${encodeURIComponent(taskId)}`;
}

const TASK_PATHNAME = /^\/lane\/tasks\/([^/]+)\/?$/;
const TASK_NAVIGATION_STATE = "__laneTaskNavigation";

type TaskNavigationState = {
  closeMode: "back" | "push";
  list: string;
  to: string;
};

let pendingTaskNavigation: TaskNavigationState | null = null;

function canonicalBrowserHref(href: string): string {
  const url = new URL(href, window.location.origin);
  url.searchParams.sort();
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}

function browserHref(): string {
  return canonicalBrowserHref(
    `${window.location.pathname}${window.location.search}`,
  );
}

function taskNavigationFromHistory(): TaskNavigationState | null {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object") return null;

  const navigation = (state as Record<string, unknown>)[TASK_NAVIGATION_STATE];
  if (!navigation || typeof navigation !== "object") return null;

  const { closeMode, list, to } = navigation as Record<string, unknown>;
  return (closeMode === "back" || closeMode === "push") &&
    typeof list === "string" &&
    typeof to === "string"
    ? { closeMode, list, to }
    : null;
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
  for (const key of WORKSPACE_PRESENTATION_PARAMS) {
    const value = source.get(key);
    if (value) url.searchParams.set(key, value);
  }
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}

/**
 * **The open task, read from the route rather than from a query parameter.**
 *
 * A row navigates to the task's canonical URL. The intercepted panel keeps the
 * current list tree alive; a direct visit bootstraps All tasks first.
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
  const [, startTransition] = React.useTransition();

  const parsed = React.useMemo<WorkspaceUrlState>(() => {
    const params = new URLSearchParams(searchString);
    return parseWorkspaceState((key) => params.get(key));
  }, [searchString]);
  const currentRouteContext = React.useMemo(
    () => contextFromPathname(pathname),
    [pathname],
  );
  // A canonical `/lane/tasks/:id` URL intentionally carries no list Context.
  // The list already mounted under an intercepted task remains its owner,
  // so each long-lived list reader remembers the last Context URL it saw.
  // A direct task visit first mounts All tasks through `TaskRouteBootstrap`,
  // giving every reader the same initial value before interception starts.
  const contextRef = React.useRef(ALL_WORKSPACE_CONTEXT);
  const listSearchRef = React.useRef(searchString);
  if (currentRouteContext) {
    contextRef.current = currentRouteContext;
    listSearchRef.current = searchString;
  }
  const context = currentRouteContext ?? contextRef.current;
  const listSearchString = currentRouteContext
    ? searchString
    : listSearchRef.current;

  const state = React.useMemo<WorkspaceUrlState>(
    () => stateForContext(parsed, context),
    [context, parsed],
  );

  const readCurrent = React.useCallback((): {
    context: WorkspaceListContext;
    params: URLSearchParams;
    state: WorkspaceUrlState;
  } => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseWorkspaceState((key) => params.get(key));
    const context =
      contextFromPathname(window.location.pathname) ?? contextRef.current;

    return {
      context,
      params,
      state: stateForContext(parsed, context),
    };
  }, []);

  // Search is the sole refinement outside the named Context. It uses replace
  // so typing does not fill browser history, and it preserves Group/Sort since
  // those describe the same list rather than a new server query.
  const replaceSearch = React.useCallback(
    (q: string) => {
      const current = readCurrent();
      const nextState = {
        ...current.state,
        filters: { ...current.state.filters, q },
      };
      const href = withPresentation(
        buildWorkspaceHref(
          current.context.pathname,
          stateForListUrl(nextState),
          {},
        ),
        current.params,
      );
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [readCurrent, router],
  );

  const clearSearch = React.useCallback(
    () => replaceSearch(""),
    [replaceSearch],
  );

  // The task's path is Context-free. Team, search, and presentation remain in
  // its query because they are independent workspace state, not its return URL.
  const taskHref = React.useCallback(
    (taskId: string) =>
      withPresentation(
        buildWorkspaceHref(
          taskPath(taskId),
          { ...stateForListUrl(state), selectedTaskId: null },
          {},
        ),
        new URLSearchParams(listSearchString),
      ),
    [listSearchString, state],
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

  /** Record the source while `<Link>` remains responsible for the navigation. */
  const rememberTaskNavigation = React.useCallback(
    (href: string, options?: { closeMode?: "back" | "push" }) => {
      const from = browserHref();
      const list = canonicalBrowserHref(listHref);
      pendingTaskNavigation = {
        closeMode: options?.closeMode ?? (from === list ? "back" : "push"),
        list,
        to: canonicalBrowserHref(href),
      };
    },
    [listHref],
  );

  /** Attach the recorded source to the new task's own browser-history entry. */
  const commitTaskNavigation = React.useCallback(() => {
    if (!pendingTaskNavigation) return;

    const current = browserHref();
    if (pendingTaskNavigation.to !== current) return;

    const state: unknown = window.history.state;
    const nextState = state && typeof state === "object" ? { ...state } : {};
    window.history.replaceState(
      {
        ...nextState,
        [TASK_NAVIGATION_STATE]: pendingTaskNavigation,
      },
      "",
      current,
    );
    pendingTaskNavigation = null;
  }, []);

  const closeTarget = React.useCallback(() => {
    const current = readCurrent();
    const fallbackHref = withPresentation(
      buildWorkspaceHref(
        current.context.pathname,
        stateForListUrl(current.state),
        {},
      ),
      current.params,
    );
    const navigation = taskNavigationFromHistory();
    const currentHref = browserHref();
    const targetHref =
      navigation?.to === currentHref && isWorkspaceListHref(navigation.list)
        ? navigation.list
        : canonicalBrowserHref(fallbackHref);

    return { currentHref, navigation, targetHref };
  }, [readCurrent]);

  /** Close to the list without erasing the task that is being closed. */
  const closeTask = React.useCallback(() => {
    const { currentHref, navigation, targetHref } = closeTarget();

    startTransition(() => {
      if (
        navigation?.to === currentHref &&
        navigation.closeMode === "back"
      ) {
        router.back();
      } else {
        router.push(targetHref, { scroll: false });
      }
    });
  }, [closeTarget, router]);

  /** A deleted task must not remain as the entry immediately being left. */
  const closeDeletedTask = React.useCallback(() => {
    const { targetHref } = closeTarget();
    startTransition(() => router.replace(targetHref, { scroll: false }));
  }, [closeTarget, router]);

  return {
    filters: state.filters,
    contextKey: context.key,
    contextPathname: context.pathname,
    fixedProjectId: context.projectId,
    taskHref,
    contextHref,
    rememberTaskNavigation,
    commitTaskNavigation,
    closeTask,
    closeDeletedTask,
    replaceSearch,
    clearSearch,
  };
}

function isWorkspaceListHref(href: string): boolean {
  const url = new URL(href, window.location.origin);
  return contextFromPathname(url.pathname) !== null;
}
