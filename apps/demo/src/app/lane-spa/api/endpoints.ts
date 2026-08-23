import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  CurrentUser,
  Insights,
  Project,
  Task,
  TaskMutationResult,
  TaskPage,
  TaskPriority,
  TaskScope,
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
 * The task writes answer with an envelope — the row, plus the insights and
 * project counts recomputed after it landed (`server/team/routes.ts`). This
 * route converges its own way and wants the row, so it unwraps and drops the
 * rest; `/lane` is the one that lives off the whole answer.
 */
export async function updateTask(
  ctx: WorkspaceCtx,
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const response = await client.api.tasks[":id"].$patch(
    { param: { id }, json: input },
    requestOptions(ctx),
  );
  await assertOk(response);
  return ((await response.json()) as TaskMutationResult).task;
}

export async function deleteTask(ctx: WorkspaceCtx, id: string): Promise<void> {
  const response = await client.api.tasks[":id"].$delete(
    { param: { id } },
    requestOptions(ctx),
  );
  await assertOk(response);
}

export async function addTaskLabel(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const response = await client.api.tasks[":id"].labels.$post(
    { param: { id: taskId }, json: { labelId } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return ((await response.json()) as TaskMutationResult).task;
}

export async function removeTaskLabel(
  ctx: WorkspaceCtx,
  taskId: string,
  labelId: string,
): Promise<Task> {
  const response = await client.api.tasks[":id"].labels[":labelId"].$delete(
    { param: { id: taskId, labelId } },
    requestOptions(ctx),
  );
  await assertOk(response);
  return ((await response.json()) as TaskMutationResult).task;
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
