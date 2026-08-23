import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  CurrentUser,
  Insights,
  Project,
  ProjectTaskCounts,
  Task,
  TaskPage,
  TaskPriority,
  TaskScope,
  TaskMutationResult,
  TaskRemovalResult,
  TaskStatus,
  TeamLabel,
  TeamMember,
  TeamSummary,
  UpdateTaskInput,
} from "@/server/api";
import { ALL_TASKS_LIMIT } from "@/lib/team-api";
import { assertOk, client, requestOptions, type WorkspaceCtx } from "./client";

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

function toTaskQuery(filters: TaskFilters) {
  const query: Record<string, string> = {};
  if (filters.scope && filters.scope !== "all") query.scope = filters.scope;
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.status.length) query.status = filters.status.join(",");
  if (filters.priority.length) query.priority = filters.priority.join(",");
  if (filters.projectId) query.projectId = filters.projectId;
  if (filters.labelId) query.labelId = filters.labelId;
  if (filters.due) query.due = filters.due;
  return query;
}

/* ------------------------------- Session ------------------------------- */

export async function fetchCurrentUser(ctx: WorkspaceCtx): Promise<CurrentUser> {
  const response = await client.api.me.$get(undefined, requestOptions(ctx));
  await assertOk(response);
  return (await response.json()) as CurrentUser;
}

export async function fetchTeams(ctx: WorkspaceCtx): Promise<TeamSummary[]> {
  const response = await client.api.teams.$get(undefined, requestOptions(ctx));
  await assertOk(response);
  return (await response.json()) as TeamSummary[];
}

/* -------------------------------- Tasks -------------------------------- */

/**
 * The whole list, in one request.
 *
 * `GET /api/tasks` always answers with a page — the rows, plus the cursor the
 * next ones start at — so a caller that wants every row says so with the
 * endpoint's ceiling and unwraps the envelope here. `/lane` is the one route
 * that reads the list a page at a time.
 */
export async function fetchTasks(
  ctx: WorkspaceCtx,
  filters: TaskFilters,
): Promise<Task[]> {
  const response = await client.api.tasks.$get(
    { query: { ...toTaskQuery(filters), limit: ALL_TASKS_LIMIT } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return ((await response.json()) as TaskPage).items;
}

/**
 * One page of the list — the form `/lane` reads it in.
 *
 * The route reads the first page (`cursor: null`) and publishes it; the browser
 * reads every page after that with the cursor the page before it handed back.
 * Same endpoint, same filters, same wrapper for both callers — the only thing
 * that differs is which side of the wire the call is made from, which is what
 * `requestOptions` stamps.
 */
export async function fetchTaskPage(
  ctx: WorkspaceCtx,
  filters: TaskFilters,
  page: { cursor: string | null; limit?: number },
): Promise<TaskPage> {
  const query: Record<string, string> = { ...toTaskQuery(filters) };
  if (page.cursor) query.cursor = page.cursor;
  if (page.limit !== undefined) query.limit = String(page.limit);

  const response = await client.api.tasks.$get(
    { query },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TaskPage;
}

export async function fetchTask(
  ctx: WorkspaceCtx,
  id: string,
): Promise<Task> {
  const response = await client.api.tasks[":id"].$get(
    { param: { id } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as Task;
}

export async function fetchTasksByIds(
  ctx: WorkspaceCtx,
  ids: string[],
): Promise<Task[]> {
  if (ids.length === 0) {
    return [];
  }

  const response = await client.api.tasks.$get(
    { query: { ids: ids.join(","), limit: ALL_TASKS_LIMIT } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return ((await response.json()) as TaskPage).items;
}

export async function createTask(
  ctx: WorkspaceCtx,
  input: CreateTaskInput,
): Promise<Task> {
  const response = await client.api.tasks.$post(
    { json: input },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as Task;
}

/**
 * **The four writes that answer with what they changed.**
 *
 * Each of these returns the task as it now is *and* the two numbers derived
 * from it — the insights and the per-project counts, recomputed by the handler
 * after the row landed (`server/team/routes.ts`). The envelope is what lets
 * `/lane` converge an inline edit without asking the route to render again:
 * every key the edit moves is in the response (`api/hooks.ts`).
 *
 * `/app-router` calls the same functions through `api/actions.ts` and uses the
 * `task` alone — its channel is a rerender, so the derivations arrive with the
 * publication instead.
 */
export async function updateTask(
  ctx: WorkspaceCtx,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskMutationResult> {
  const response = await client.api.tasks[":id"].$patch(
    { param: { id }, json: input },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TaskMutationResult;
}

/** The delete answers with the derivations alone: there is no row left. */
export async function deleteTask(
  ctx: WorkspaceCtx,
  id: string,
): Promise<TaskRemovalResult> {
  const response = await client.api.tasks[":id"].$delete(
    { param: { id } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TaskRemovalResult;
}

export async function addTaskLabel(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<TaskMutationResult> {
  const response = await client.api.tasks[":id"].labels.$post(
    { param: { id: taskId }, json: { labelId } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TaskMutationResult;
}

export async function removeTaskLabel(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<TaskMutationResult> {
  const response = await client.api.tasks[":id"].labels[":labelId"].$delete(
    { param: { id: taskId, labelId } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TaskMutationResult;
}

/* ------------------------------ Reference ------------------------------ */

export async function fetchProjects(ctx: WorkspaceCtx): Promise<Project[]> {
  const response = await client.api.projects.$get(
    undefined,
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as Project[];
}

/**
 * How many tasks are in each project, keyed by project id — the server's own
 * type, re-exported here so the reads and the mutation envelope that carry it
 * cannot drift apart.
 */
export type { ProjectTaskCounts };

export async function fetchProjectTaskCounts(
  ctx: WorkspaceCtx,
): Promise<ProjectTaskCounts> {
  const response = await client.api.projects.counts.$get(
    undefined,
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as ProjectTaskCounts;
}

export async function createProject(
  ctx: WorkspaceCtx,
  input: CreateProjectInput,
): Promise<Project> {
  const response = await client.api.projects.$post(
    { json: input },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as Project;
}

export async function fetchLabels(
  ctx: WorkspaceCtx,
  q = "",
): Promise<TeamLabel[]> {
  const response = await client.api.labels.$get(
    { query: q ? { q } : {} },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TeamLabel[];
}

export async function createLabel(
  ctx: WorkspaceCtx,
  input: CreateLabelInput,
): Promise<TeamLabel> {
  const response = await client.api.labels.$post(
    { json: input },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TeamLabel;
}

export async function fetchMembers(
  ctx: WorkspaceCtx,
  q = "",
): Promise<TeamMember[]> {
  const response = await client.api.members.$get(
    { query: q ? { q } : {} },
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as TeamMember[];
}

export async function fetchInsights(ctx: WorkspaceCtx): Promise<Insights> {
  const response = await client.api.insights.$get(
    undefined,
    requestOptions(ctx),
  );
  await assertOk(response);
  return (await response.json()) as Insights;
}
