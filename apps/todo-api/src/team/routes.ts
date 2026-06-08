import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
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
} from "./db.js";
import {
  addTaskLabelInputSchema,
  createLabelInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  listLabelsQuerySchema,
  listMembersQuerySchema,
  listTasksQuerySchema,
  updateTaskInputSchema,
} from "./schema.js";

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
  const user = getUserById(userId);

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
    const teams = listTeamsForUser(userId);
    const requestedTeamId = context.req.header("x-team-id");
    const teamId = requestedTeamId ?? teams[0]?.id;

    if (!teamId) {
      return context.json({ error: "No active team", code: "no_team" }, 400);
    }

    const role = getMembershipRole(teamId, userId);

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

export const teamRoutes = team
  .get("/me", (context) => {
    const user = getCurrentUser(context.get("userId"));

    if (!user) {
      return context.json({ error: "Unknown user" }, 404);
    }

    return context.json(user, 200);
  })
  .get("/teams", (context) => {
    return context.json(listTeamsForUser(context.get("userId")), 200);
  })
  .get(
    "/tasks",
    zValidator("query", listTasksQuerySchema, validationHook),
    (context) => {
      const query = context.req.valid("query");

      return context.json(
        listTasks(context.get("teamId"), context.get("userId"), {
          q: query.q,
          scope: query.scope,
          status: query.status,
          priority: query.priority,
          projectId: query.projectId,
          labelId: query.labelId,
          due: query.due,
        }),
        200,
      );
    },
  )
  .post(
    "/tasks",
    zValidator("json", createTaskInputSchema, validationHook),
    (context) => {
      const task = createTask(
        context.get("teamId"),
        context.get("userId"),
        context.req.valid("json"),
      );

      return context.json(task, 201);
    },
  )
  .get("/tasks/:id", (context) => {
    const task = getTask(context.get("teamId"), context.req.param("id"));

    if (!task) {
      return context.json({ error: "Task not found" }, 404);
    }

    return context.json(task, 200);
  })
  .patch(
    "/tasks/:id",
    zValidator("json", updateTaskInputSchema, validationHook),
    (context) => {
      const task = updateTask(
        context.get("teamId"),
        context.req.param("id"),
        context.req.valid("json"),
      );

      if (!task) {
        return context.json({ error: "Task not found" }, 404);
      }

      return context.json(task, 200);
    },
  )
  .delete("/tasks/:id", (context) => {
    const deleted = deleteTask(
      context.get("teamId"),
      context.req.param("id"),
    );

    if (!deleted) {
      return context.json({ error: "Task not found" }, 404);
    }

    return context.body(null, 204);
  })
  .post(
    "/tasks/:id/labels",
    zValidator("json", addTaskLabelInputSchema, validationHook),
    (context) => {
      const task = addTaskLabel(
        context.get("teamId"),
        context.req.param("id"),
        context.req.valid("json").labelId,
      );

      if (!task) {
        return context.json({ error: "Task or label not found" }, 404);
      }

      return context.json(task, 200);
    },
  )
  .delete("/tasks/:id/labels/:labelId", (context) => {
    const task = removeTaskLabel(
      context.get("teamId"),
      context.req.param("id"),
      context.req.param("labelId"),
    );

    if (!task) {
      return context.json({ error: "Task not found" }, 404);
    }

    return context.json(task, 200);
  })
  .get("/projects", (context) => {
    return context.json(listProjects(context.get("teamId")), 200);
  })
  .post(
    "/projects",
    zValidator("json", createProjectInputSchema, validationHook),
    (context) => {
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
        createProject(context.get("teamId"), context.req.valid("json")),
        201,
      );
    },
  )
  .get(
    "/labels",
    zValidator("query", listLabelsQuerySchema, validationHook),
    (context) => {
      return context.json(
        listLabels(context.get("teamId"), context.req.valid("query").q ?? ""),
        200,
      );
    },
  )
  .post(
    "/labels",
    zValidator("json", createLabelInputSchema, validationHook),
    (context) => {
      return context.json(
        createLabel(context.get("teamId"), context.req.valid("json")),
        201,
      );
    },
  )
  .get(
    "/members",
    zValidator("query", listMembersQuerySchema, validationHook),
    (context) => {
      return context.json(
        listMembers(context.get("teamId"), context.req.valid("query").q ?? ""),
        200,
      );
    },
  )
  .get("/insights", (context) => {
    return context.json(
      getInsights(context.get("teamId"), context.get("userId")),
      200,
    );
  });

export type TeamRoutes = typeof teamRoutes;
