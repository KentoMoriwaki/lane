import { GraphQLError } from "graphql";
import {
  DEFAULT_USER_ID,
  addTaskLabel,
  createLabel,
  createProject,
  createTask,
  deleteTask,
  getCurrentUser,
  getInsights,
  getMembershipRole,
  getTask,
  getUserById,
  listLabels,
  listMembers,
  listProjects,
  listTasks,
  listTeamsForUser,
  removeTaskLabel,
  updateTask,
} from "@/server/team/db";
import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskScope,
  TaskStatus,
  UpdateTaskInput,
} from "@/server/team/schema";

/**
 * Resolvers for the Relay GraphQL endpoint.
 *
 * Every resolver delegates to the same `db.ts` the REST API uses, so the two
 * surfaces serve identical data. The only graph-specific work is resolving the
 * dependency edges (`blockedBy` / `blocks`) from ids to `Task` nodes, which is
 * what lets a single query traverse the dependency graph and `@defer` it.
 */

/* ------------------------------- Context ------------------------------- */

export type GraphQLContext = {
  userId: string;
  teamId: string | null;
  role: "admin" | "member" | null;
};

/**
 * Build the per-request context from the same headers the REST client sends
 * (`x-user-id` / `x-team-id`), resolving the active team and verifying
 * membership exactly like the Hono team-scope middleware.
 */
export async function buildContext(
  headers: Headers,
): Promise<GraphQLContext> {
  const userId = headers.get("x-user-id")?.trim() || DEFAULT_USER_ID;
  const user = await getUserById(userId);

  if (!user) {
    throw new GraphQLError("Unknown user", {
      extensions: { code: "unauthenticated", http: { status: 401 } },
    });
  }

  const teams = await listTeamsForUser(userId);
  const requestedTeamId = headers.get("x-team-id")?.trim();
  const teamId = requestedTeamId || teams[0]?.id || null;
  const role = teamId ? await getMembershipRole(teamId, userId) : null;

  // A requested team the user is not a member of is forbidden, matching REST.
  if (requestedTeamId && !role) {
    throw new GraphQLError("You are not a member of this team", {
      extensions: { code: "forbidden", http: { status: 403 } },
    });
  }

  return { userId, teamId, role };
}

/** Assert (and narrow) that the request resolved to a team the viewer can read. */
function requireTeam(ctx: GraphQLContext): string {
  if (!ctx.teamId || !ctx.role) {
    throw new GraphQLError("No active team", {
      extensions: { code: "no_team", http: { status: 400 } },
    });
  }
  return ctx.teamId;
}

/* ----------------------------- Latency knobs ---------------------------- */

// Mirror the REST app's artificial latency so the Suspense / transition states
// the demo exists to show stay observable. `insights` and `projects` get an
// extra derived-data delay — they are the fields the workspace query `@defer`s.
const readDelayMs = readMs(process.env.TEAM_API_READ_DELAY_MS, 100);
const writeDelayMs = readMs(process.env.TEAM_API_WRITE_DELAY_MS, 100);
const pickerDelayMs = readMs(process.env.TEAM_API_PICKER_DELAY_MS, 100);
const derivedDelayMs = readDelayMs > 0 ? readDelayMs + 200 : 0;

function readMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------- Helpers ------------------------------- */

function toCsv(values: readonly string[] | null | undefined): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

type TaskFilterInput = {
  scope?: TaskScope | null;
  q?: string | null;
  status?: TaskStatus[] | null;
  priority?: TaskPriority[] | null;
  projectId?: string | null;
  labelId?: string | null;
  due?: "overdue" | "today" | "week" | null;
};

/* ------------------------------ Resolvers ------------------------------ */

export const resolvers = {
  Node: {
    __resolveType(value: { id: string }): string | null {
      if (typeof value?.id !== "string") return null;
      if (value.id.startsWith("task_")) return "Task";
      if (value.id.startsWith("p_")) return "Project";
      if (value.id.startsWith("l_")) return "Label";
      if (value.id.startsWith("t_")) return "TeamSummary";
      return null;
    },
  },

  Query: {
    async node(_root: unknown, args: { id: string }, ctx: GraphQLContext) {
      // Powers `@refetchable` fragment refetches; the detail panel refetch is
      // the only node() consumer, so resolving Task is sufficient.
      if (args.id.startsWith("task_")) {
        await delay(readDelayMs);
        return getTask(requireTeam(ctx), args.id);
      }
      return null;
    },

    async viewer(_root: unknown, _args: unknown, ctx: GraphQLContext) {
      const user = await getCurrentUser(ctx.userId);
      if (!user) {
        throw new GraphQLError("Unknown user", {
          extensions: { code: "unauthenticated" },
        });
      }
      // A node id distinct from the raw user id so the Viewer record and the
      // TeamMember record for the same person never collide in the store.
      return { ...user, userId: user.id, id: `viewer:${user.id}` };
    },

    teams(_root: unknown, _args: unknown, ctx: GraphQLContext) {
      return listTeamsForUser(ctx.userId);
    },

    async tasks(
      _root: unknown,
      args: { filters?: TaskFilterInput | null },
      ctx: GraphQLContext,
    ) {
      await delay(readDelayMs);
      const filters = args.filters ?? {};
      return listTasks(requireTeam(ctx), ctx.userId, {
        scope: filters.scope ?? undefined,
        q: filters.q ?? undefined,
        status: toCsv(filters.status),
        priority: toCsv(filters.priority),
        projectId: filters.projectId ?? undefined,
        labelId: filters.labelId ?? undefined,
        due: filters.due ?? undefined,
      });
    },

    async task(_root: unknown, args: { id: string }, ctx: GraphQLContext) {
      await delay(readDelayMs);
      return getTask(requireTeam(ctx), args.id);
    },

    async projects(_root: unknown, _args: unknown, ctx: GraphQLContext) {
      await delay(derivedDelayMs);
      return listProjects(requireTeam(ctx));
    },

    async labels(
      _root: unknown,
      args: { q?: string | null },
      ctx: GraphQLContext,
    ) {
      await delay(pickerDelayMs);
      return listLabels(requireTeam(ctx), args.q ?? "");
    },

    async members(
      _root: unknown,
      args: { q?: string | null },
      ctx: GraphQLContext,
    ) {
      await delay(pickerDelayMs);
      return listMembers(requireTeam(ctx), args.q ?? "");
    },

    async insights(_root: unknown, _args: unknown, ctx: GraphQLContext) {
      await delay(derivedDelayMs);
      return getInsights(requireTeam(ctx), ctx.userId);
    },
  },

  Task: {
    // Dependency edges arrive from the db as id arrays; resolve them to Task
    // nodes so the graph can be traversed (and `@defer`-ed) in one query. The
    // store dedupes any task that is also present in the main list.
    async blockedBy(parent: Task, _args: unknown, ctx: GraphQLContext) {
      return resolveTasks(parent.teamId, parent.blockedBy, ctx);
    },
    async blocks(parent: Task, _args: unknown, ctx: GraphQLContext) {
      return resolveTasks(parent.teamId, parent.blocks, ctx);
    },
  },

  Mutation: {
    async createTask(
      _root: unknown,
      args: { input: CreateTaskInput },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      return createTask(requireTeam(ctx), ctx.userId, args.input);
    },

    async updateTask(
      _root: unknown,
      args: { id: string; input: UpdateTaskInput },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      const task = await updateTask(requireTeam(ctx), args.id, args.input);
      if (!task) throw notFound("Task");
      return task;
    },

    async deleteTask(
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      const deleted = await deleteTask(requireTeam(ctx), args.id);
      if (!deleted) throw notFound("Task");
      return { deletedTaskId: args.id };
    },

    async addTaskLabel(
      _root: unknown,
      args: { taskId: string; labelId: string },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      const task = await addTaskLabel(requireTeam(ctx), args.taskId, args.labelId);
      if (!task) throw notFound("Task or label");
      return task;
    },

    async removeTaskLabel(
      _root: unknown,
      args: { taskId: string; labelId: string },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      const task = await removeTaskLabel(
        requireTeam(ctx),
        args.taskId,
        args.labelId,
      );
      if (!task) throw notFound("Task");
      return task;
    },

    async createLabel(
      _root: unknown,
      args: { input: CreateLabelInput },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      return createLabel(requireTeam(ctx), args.input);
    },

    async createProject(
      _root: unknown,
      args: { input: CreateProjectInput },
      ctx: GraphQLContext,
    ) {
      await delay(writeDelayMs);
      const teamId = requireTeam(ctx);
      // Creating a project is admin-only, matching the REST route.
      if (ctx.role !== "admin") {
        throw new GraphQLError("Only team admins can create projects", {
          extensions: { code: "forbidden", http: { status: 403 } },
        });
      }
      return createProject(teamId, args.input);
    },
  },
};

async function resolveTasks(
  teamId: string,
  ids: string[],
  _ctx: GraphQLContext,
): Promise<Task[]> {
  // Slow on purpose so the `@defer`-ed dependency graph in the detail panel
  // streams in visibly after the rest of the task has rendered.
  await delay(derivedDelayMs);
  const tasks = await Promise.all(ids.map((id) => getTask(teamId, id)));
  return tasks.filter((task): task is Task => task !== null);
}

function notFound(what: string): GraphQLError {
  return new GraphQLError(`${what} not found`, {
    extensions: { code: "not_found", http: { status: 404 } },
  });
}
