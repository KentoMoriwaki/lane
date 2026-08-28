import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";

export const LANE_ROOT_PATH = "/lane";
export const CONTEXTS_PATH = `${LANE_ROOT_PATH}/contexts`;
export const PROJECTS_PATH = `${LANE_ROOT_PATH}/projects`;
export const TASKS_PATH = `${LANE_ROOT_PATH}/tasks`;

export const WORKSPACE_PRESENTATION_PARAMS = ["group", "sort", "order"] as const;
export const TASK_WORKSPACE_PARAMS = [
  "team",
  "q",
  ...WORKSPACE_PRESENTATION_PARAMS,
] as const;

export function workspaceQueryFromRecord(
  record: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const key of TASK_WORKSPACE_PARAMS) {
    const value = record[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }
  return query.toString();
}

export const STATIC_WORKSPACE_CONTEXT_KEYS = [
  "all",
  "mine",
  "unassigned",
  "overdue",
  "due-soon",
  "completed",
] as const;

export type StaticWorkspaceContextKey =
  (typeof STATIC_WORKSPACE_CONTEXT_KEYS)[number];

/** The canonical entry to the workspace: the cross-project Context. */
export const LANE_PATH = `${CONTEXTS_PATH}/all`;

export type WorkspaceContextKey = StaticWorkspaceContextKey | "project";

export type WorkspaceListContext = {
  key: WorkspaceContextKey;
  pathname: string;
  projectId: string | null;
};

export const WORKSPACE_CONTEXT_PATHS: Record<
  StaticWorkspaceContextKey,
  string
> = {
  all: LANE_PATH,
  mine: `${CONTEXTS_PATH}/mine`,
  unassigned: `${CONTEXTS_PATH}/unassigned`,
  overdue: `${CONTEXTS_PATH}/overdue`,
  "due-soon": `${CONTEXTS_PATH}/due-soon`,
  completed: `${CONTEXTS_PATH}/completed`,
};

const PROJECT_PATHNAME = /^\/lane\/projects\/([^/]+)\/?$/;

export const ALL_WORKSPACE_CONTEXT: WorkspaceListContext = {
  key: "all",
  pathname: LANE_PATH,
  projectId: null,
};

export function projectPath(projectId: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(projectId)}`;
}

export function contextPath(
  key: StaticWorkspaceContextKey,
): string {
  return WORKSPACE_CONTEXT_PATHS[key];
}

export function contextFromPathname(
  pathname: string,
): WorkspaceListContext | null {
  const normalized = pathname.replace(/\/$/, "") || "/";

  for (const [key, path] of Object.entries(WORKSPACE_CONTEXT_PATHS)) {
    if (normalized === path) {
      return {
        key: key as Exclude<WorkspaceContextKey, "project">,
        pathname: path,
        projectId: null,
      };
    }
  }

  const projectMatch = PROJECT_PATHNAME.exec(normalized);
  if (!projectMatch) return null;

  const projectId = decodeURIComponent(projectMatch[1]);
  return {
    key: "project",
    pathname: projectPath(projectId),
    projectId,
  };
}

/**
 * A Context owns the task-set predicate. Search is the one independent
 * refinement: it stays in the topbar, while every old ad-hoc filter is dropped.
 */
export function filtersForContext(
  input: TaskFilters,
  context: WorkspaceListContext,
): TaskFilters {
  const filters: TaskFilters = { ...EMPTY_FILTERS, q: input.q };

  switch (context.key) {
    case "mine":
      return { ...filters, scope: "mine" };
    case "unassigned":
      return { ...filters, scope: "unassigned" };
    case "overdue":
      return { ...filters, due: "overdue" };
    case "due-soon":
      return { ...filters, due: "week" };
    case "completed":
      return { ...filters, status: ["done"] };
    case "project":
      return { ...filters, projectId: context.projectId };
    case "all":
      return filters;
  }
}

/** Only search crosses from one named Context to another. */
export function filtersForContextUrl(filters: TaskFilters): TaskFilters {
  return { ...EMPTY_FILTERS, q: filters.q };
}

export function contextForKey(
  key: StaticWorkspaceContextKey,
): WorkspaceListContext {
  return {
    key,
    pathname: contextPath(key),
    projectId: null,
  };
}

export function isStaticWorkspaceContextKey(
  value: string,
): value is StaticWorkspaceContextKey {
  return (STATIC_WORKSPACE_CONTEXT_KEYS as readonly string[]).includes(value);
}
