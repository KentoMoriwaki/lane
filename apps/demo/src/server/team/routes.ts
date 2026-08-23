import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { TASK_PAGE_LIMIT_MAX, TASK_PAGE_SIZE } from "@/lib/team-api";
import {
  DEFAULT_USER_ID,
  addTaskLabel,
  createLabel,
  createProject,
  createTask,
  decodeTaskCursor,
  deleteTask,
  getCurrentUser,
  getInsights,
  getMembershipRole,
  getTask,
  getUserById,
  listLabels,
  listMembers,
  listProjectTaskCounts,
  listProjects,
  listTaskPage,
  listTeamsForUser,
  removeTaskLabel,
  updateTask,
} from "./db";
import { delay, readMilliseconds } from "./latency";
import {
  addTaskLabelInputSchema,
  createLabelInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  listLabelsQuerySchema,
  listMembersQuerySchema,
  listTasksQuerySchema,
  updateTaskInputSchema,
} from "./schema";

type Variables = {
  userId: string;
  teamId: string;
  role: "admin" | "member";
};

const team = new Hono<{ Variables: Variables }>();

/**
 * Mock authentication. The active user is read from the `x-user-id` header and
 * falls back to a seeded default user. This is intentionally lightweight; the
 * point is to give the frontend a real request context to send.
 */
team.use("*", async (context, next) => {
  const userId = context.req.header("x-user-id") ?? DEFAULT_USER_ID;
  const user = await getUserById(userId);

  if (!user) {
    return context.json(
      { error: "Unknown user", code: "unauthenticated" },
      401,
    );
  }

  context.set("userId", userId);
  await next();
});

/**
 * Active-team context. Team-scoped routes resolve the team from the
 * `x-team-id` header (or the user's first team) and verify membership. This
 * keeps `teamId` out of frontend query keys while still enforcing scope on the
 * server, matching the team-scope constraint in the implementation doc.
 */
const teamScopedPaths = [
  "/tasks",
  "/tasks/*",
  "/projects",
  "/projects/*",
  "/labels",
  "/labels/*",
  "/members",
  "/insights",
];

for (const path of teamScopedPaths) {
  team.use(path, async (context, next) => {
    const userId = context.get("userId");
    const teams = await listTeamsForUser(userId);
    const requestedTeamId = context.req.header("x-team-id");
    const teamId = requestedTeamId ?? teams[0]?.id;

    if (!teamId) {
      return context.json({ error: "No active team", code: "no_team" }, 400);
    }

    const role = await getMembershipRole(teamId, userId);

    if (!role) {
      return context.json(
        { error: "You are not a member of this team", code: "forbidden" },
        403,
      );
    }

    context.set("teamId", teamId);
    context.set("role", role);
    await next();
  });
}

const validationHook = (
  result: { success: boolean; error?: { message: string } },
  context: { json: (body: unknown, status: 400) => Response },
) => {
  if (!result.success) {
    return context.json(
      { error: result.error?.message ?? "Invalid request" },
      400,
    );
  }
};

const DERIVED_DATA_DELAY_MS = readMilliseconds(
  process.env.TEAM_API_DERIVED_DELAY_MS,
  30,
);

/**
 * The two numbers a task write moves, recomputed after it lands.
 *
 * Every task mutation below answers with these beside whatever it changed. The
 * insights and the project counts are derived from the tasks table, so a write
 * that has just changed a row is the one place in the system that knows they
 * are wrong and can produce the right ones in the same breath — one extra read
 * each, here, instead of two more round trips from whoever made the edit.
 *
 * They are the same values `GET /insights` and `GET /projects/counts` serve,
 * computed by the same functions, and they carry the same modelled cost: a
 * derivation is not cheaper because a write asked for it.
 */
async function derivationsAfterTaskWrite(teamId: string, userId: string) {
  const [insights, projectCounts] = await Promise.all([
    getInsights(teamId, userId),
    listProjectTaskCounts(teamId),
    delay(DERIVED_DATA_DELAY_MS),
  ]);

  return { insights, projectCounts };
}

export const teamRoutes = team
  .get("/me", async (context) => {
    const user = await getCurrentUser(context.get("userId"));

    if (!user) {
      return context.json({ error: "Unknown user" }, 404);
    }

    return context.json(user, 200);
  })
  .get("/teams", async (context) => {
    return context.json(await listTeamsForUser(context.get("userId")), 200);
  })
  /**
   * The task list, one page at a time.
   *
   * `limit` defaults to {@link TASK_PAGE_SIZE} and `cursor` continues strictly
   * after the row it names, so the response is always an envelope — the rows
   * and where the next ones start. A caller that wants the list entire says so
   * by asking for {@link TASK_PAGE_LIMIT_MAX}; every route in this demo except
   * `/lane` does exactly that, which keeps one shape for one endpoint instead
   * of a response that changes with its query string.
   */
  .get(
    "/tasks",
    zValidator("query", listTasksQuerySchema, validationHook),
    async (context) => {
      const query = context.req.valid("query");
      const cursor = query.cursor ? decodeTaskCursor(query.cursor) : null;

      if (query.cursor && !cursor) {
        return context.json(
          { error: "Cursor could not be decoded", code: "invalid_cursor" },
          400,
        );
      }

      const requested = Number.parseInt(query.limit ?? "", 10);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 1), TASK_PAGE_LIMIT_MAX)
        : TASK_PAGE_SIZE;

      return context.json(
        await listTaskPage(
          context.get("teamId"),
          context.get("userId"),
          {
            q: query.q,
            scope: query.scope,
            status: query.status,
            priority: query.priority,
            projectId: query.projectId,
            labelId: query.labelId,
            due: query.due,
            ids: query.ids,
          },
          { cursor, limit },
        ),
        200,
      );
    },
  )
  .post(
    "/tasks",
    zValidator("json", createTaskInputSchema, validationHook),
    async (context) => {
      const task = await createTask(
        context.get("teamId"),
        context.get("userId"),
        context.req.valid("json"),
      );

      return context.json(task, 201);
    },
  )
  .get("/tasks/:id", async (context) => {
    const task = await getTask(context.get("teamId"), context.req.param("id"));

    if (!task) {
      return context.json({ error: "Task not found" }, 404);
    }

    return context.json(task, 200);
  })
  /**
   * The four task writes below answer with what the edit changed: the row as
   * it now is, and the two derivations that moved with it
   * ({@link derivationsAfterTaskWrite}). A caller holding the response holds
   * everything the write touched, and has nothing left to go and read.
   */
  .patch(
    "/tasks/:id",
    zValidator("json", updateTaskInputSchema, validationHook),
    async (context) => {
      const task = await updateTask(
        context.get("teamId"),
        context.req.param("id"),
        context.req.valid("json"),
      );

      if (!task) {
        return context.json({ error: "Task not found" }, 404);
      }

      return context.json(
        {
          task,
          ...(await derivationsAfterTaskWrite(
            context.get("teamId"),
            context.get("userId"),
          )),
        },
        200,
      );
    },
  )
  // 200 with a body rather than 204: a delete moves the same two numbers every
  // other task write moves, and the caller that removed the row is the one that
  // has to show them.
  .delete("/tasks/:id", async (context) => {
    const deleted = await deleteTask(
      context.get("teamId"),
      context.req.param("id"),
    );

    if (!deleted) {
      return context.json({ error: "Task not found" }, 404);
    }

    return context.json(
      await derivationsAfterTaskWrite(
        context.get("teamId"),
        context.get("userId"),
      ),
      200,
    );
  })
  .post(
    "/tasks/:id/labels",
    zValidator("json", addTaskLabelInputSchema, validationHook),
    async (context) => {
      const task = await addTaskLabel(
        context.get("teamId"),
        context.req.param("id"),
        context.req.valid("json").labelId,
      );

      if (!task) {
        return context.json({ error: "Task or label not found" }, 404);
      }

      return context.json(
        {
          task,
          ...(await derivationsAfterTaskWrite(
            context.get("teamId"),
            context.get("userId"),
          )),
        },
        200,
      );
    },
  )
  .delete("/tasks/:id/labels/:labelId", async (context) => {
    const task = await removeTaskLabel(
      context.get("teamId"),
      context.req.param("id"),
      context.req.param("labelId"),
    );

    if (!task) {
      return context.json({ error: "Task not found" }, 404);
    }

    return context.json(
      {
        task,
        ...(await derivationsAfterTaskWrite(
          context.get("teamId"),
          context.get("userId"),
        )),
      },
      200,
    );
  })
  .get("/projects", async (context) => {
    await delay(DERIVED_DATA_DELAY_MS);
    return context.json(await listProjects(context.get("teamId")), 200);
  })
  // The counts, separately from the projects. They are derived from tasks, so
  // whoever reads them cannot cache them the way the roster of projects is
  // cached — see `app/lane/api/route-reads.ts`.
  .get("/projects/counts", async (context) => {
    await delay(DERIVED_DATA_DELAY_MS);
    return context.json(
      await listProjectTaskCounts(context.get("teamId")),
      200,
    );
  })
  .post(
    "/projects",
    zValidator("json", createProjectInputSchema, validationHook),
    async (context) => {
      // Creating a project is an admin-only action. Non-admins receive a
      // permission-aware response rather than a generic failure.
      if (context.get("role") !== "admin") {
        return context.json(
          {
            error: "Only team admins can create projects",
            code: "forbidden",
          },
          403,
        );
      }

      return context.json(
        await createProject(context.get("teamId"), context.req.valid("json")),
        201,
      );
    },
  )
  .get(
    "/labels",
    zValidator("query", listLabelsQuerySchema, validationHook),
    async (context) => {
      return context.json(
        await listLabels(
          context.get("teamId"),
          context.req.valid("query").q ?? "",
        ),
        200,
      );
    },
  )
  .post(
    "/labels",
    zValidator("json", createLabelInputSchema, validationHook),
    async (context) => {
      return context.json(
        await createLabel(context.get("teamId"), context.req.valid("json")),
        201,
      );
    },
  )
  .get(
    "/members",
    zValidator("query", listMembersQuerySchema, validationHook),
    async (context) => {
      return context.json(
        await listMembers(
          context.get("teamId"),
          context.req.valid("query").q ?? "",
        ),
        200,
      );
    },
  )
  .get("/insights", async (context) => {
    await delay(DERIVED_DATA_DELAY_MS);
    return context.json(
      await getInsights(context.get("teamId"), context.get("userId")),
      200,
    );
  });

export type TeamRoutes = typeof teamRoutes;
