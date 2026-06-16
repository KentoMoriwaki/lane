import type {
  TaskPriority,
  TaskScope,
  TaskStatus,
} from "@/server/api";

/**
 * The durable view state for the task list. Identical in shape to the other
 * variants; the Relay variant keeps it in local React state (no URL), and
 * converts it to a `TaskFilterInput` when it drives a query.
 */
export type TaskFilters = {
  scope: TaskScope;
  q: string;
  status: TaskStatus[];
  priority: TaskPriority[];
  projectId: string | null;
  labelId: string | null;
  due: "overdue" | "today" | "week" | null;
};

export const EMPTY_FILTERS: TaskFilters = {
  scope: "all",
  q: "",
  status: [],
  priority: [],
  projectId: null,
  labelId: null,
  due: null,
};

/** The GraphQL `TaskFilterInput` shape the relay-compiler generates. */
export type TaskFilterInput = {
  scope?: TaskScope | null;
  q?: string | null;
  status?: readonly TaskStatus[] | null;
  priority?: readonly TaskPriority[] | null;
  projectId?: string | null;
  labelId?: string | null;
  due?: "overdue" | "today" | "week" | null;
};

/** Map the local filter state to query variables, omitting empty selections. */
export function toGraphQLFilters(filters: TaskFilters): TaskFilterInput {
  return {
    scope: filters.scope !== "all" ? filters.scope : null,
    q: filters.q.trim() ? filters.q.trim() : null,
    status: filters.status.length ? filters.status : null,
    priority: filters.priority.length ? filters.priority : null,
    projectId: filters.projectId,
    labelId: filters.labelId,
    due: filters.due,
  };
}
