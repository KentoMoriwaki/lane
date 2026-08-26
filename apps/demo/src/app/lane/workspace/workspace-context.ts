import { EMPTY_FILTERS, type TaskFilters } from "@/app/lane/api/endpoints";

export const LANE_PATH = "/lane";

export type WorkspaceContextKey =
  | "all"
  | "mine"
  | "unassigned"
  | "overdue"
  | "due-soon"
  | "completed"
  | "project";

export type WorkspaceListContext = {
  key: WorkspaceContextKey;
  pathname: string;
  projectId: string | null;
};

export const WORKSPACE_CONTEXT_PATHS: Record<
  Exclude<WorkspaceContextKey, "project">,
  string
> = {
  all: LANE_PATH,
  mine: `${LANE_PATH}/mine`,
  unassigned: `${LANE_PATH}/unassigned`,
  overdue: `${LANE_PATH}/overdue`,
  "due-soon": `${LANE_PATH}/due-soon`,
  completed: `${LANE_PATH}/completed`,
};

const PROJECT_PATHNAME = /^\/lane\/project\/([^/]+)\/?$/;

export const ALL_WORKSPACE_CONTEXT: WorkspaceListContext = {
  key: "all",
  pathname: LANE_PATH,
  projectId: null,
};

export function projectPath(projectId: string): string {
  return `${LANE_PATH}/project/${encodeURIComponent(projectId)}`;
}

export function contextPath(
  key: Exclude<WorkspaceContextKey, "project">,
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

  const projectMatch = PROJECT_PATHNAME.exec(pathname);
  if (!projectMatch) return null;

  const projectId = decodeURIComponent(projectMatch[1]);
  return {
    key: "project",
    pathname: projectPath(projectId),
    projectId,
  };
}

/** Convert the old query shortcuts into their named Context on a warm URL. */
export function legacyContextFromFilters(
  filters: TaskFilters,
): WorkspaceContextKey | null {
  if (filters.projectId) return "project";
  if (filters.scope === "mine") return "mine";
  if (filters.scope === "unassigned") return "unassigned";
  if (filters.due === "overdue") return "overdue";
  if (filters.due === "week") return "due-soon";
  if (filters.status.length === 1 && filters.status[0] === "done") {
    return "completed";
  }
  return null;
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
  key: Exclude<WorkspaceContextKey, "project">,
): WorkspaceListContext {
  return {
    key,
    pathname: contextPath(key),
    projectId: null,
  };
}
