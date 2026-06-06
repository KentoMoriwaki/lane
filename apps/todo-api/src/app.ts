import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  addLabelToTodo,
  createLabel,
  createTodo,
  deleteTodo,
  listLabels,
  listTodos,
  removeLabelFromTodo,
  updateTodo,
} from "./db.js";

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  labels: z.array(labelSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createTodoInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const updateTodoInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    completed: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.completed !== undefined, {
    message: "At least one field must be provided",
  });

export const listLabelsQuerySchema = z.object({
  limit: z.string().optional(),
  q: z.string().optional(),
});

export const createLabelInputSchema = z.object({
  name: z.string().trim().min(1).max(48),
});

export const addTodoLabelInputSchema = z.object({
  labelId: z.string().min(1),
});

export type Label = z.infer<typeof labelSchema>;
export type Todo = z.infer<typeof todoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoInputSchema>;

const app = new Hono();
const defaultDelayMs = 1_000;
const apiDelayMs = Number(process.env.TODO_API_DELAY_MS ?? defaultDelayMs);

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.use("*", async (context, next) => {
  if (
    context.req.path === "/labels" ||
    context.req.path === "/todos" ||
    context.req.path.startsWith("/todos/")
  ) {
    await delay(apiDelayMs);
  }

  await next();
});

export const routes = app
  .get("/health", (context) => context.json({ ok: true }, 200))
  .get("/todos", (context) => context.json(listTodos(), 200))
  .get(
    "/labels",
    zValidator("query", listLabelsQuerySchema, (result, context) => {
      if (!result.success) {
        return context.json({ error: result.error.message }, 400);
      }
    }),
    (context) => {
      const query = context.req.valid("query");

      return context.json(
        listLabels({
          limit: readLabelLimit(query.limit),
          q: query.q ?? "",
        }),
        200,
      );
    },
  )
  .post(
    "/labels",
    zValidator("json", createLabelInputSchema, (result, context) => {
      if (!result.success) {
        return context.json({ error: result.error.message }, 400);
      }
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(createLabel(input.name), 201);
    },
  )
  .post(
    "/todos",
    zValidator("json", createTodoInputSchema, (result, context) => {
      if (!result.success) {
        return context.json({ error: result.error.message }, 400);
      }
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(createTodo(input.title), 201);
    },
  )
  .patch(
    "/todos/:id",
    zValidator("json", updateTodoInputSchema, (result, context) => {
      if (!result.success) {
        return context.json({ error: result.error.message }, 400);
      }
    }),
    (context) => {
      const todo = updateTodo(
        context.req.param("id"),
        context.req.valid("json"),
      );

      if (!todo) {
        return context.json({ error: "Todo not found" }, 404);
      }

      return context.json(todo, 200);
    },
  )
  .post(
    "/todos/:id/labels",
    zValidator("json", addTodoLabelInputSchema, (result, context) => {
      if (!result.success) {
        return context.json({ error: result.error.message }, 400);
      }
    }),
    (context) => {
      const todo = addLabelToTodo(
        context.req.param("id"),
        context.req.valid("json").labelId,
      );

      if (!todo) {
        return context.json({ error: "Todo or label not found" }, 404);
      }

      return context.json(todo, 200);
    },
  )
  .delete("/todos/:id/labels/:labelId", (context) => {
    const todo = removeLabelFromTodo(
      context.req.param("id"),
      context.req.param("labelId"),
    );

    if (!todo) {
      return context.json({ error: "Todo not found" }, 404);
    }

    return context.json(todo, 200);
  })
  .delete("/todos/:id", (context) => {
    const deleted = deleteTodo(context.req.param("id"));

    if (!deleted) {
      return context.json({ error: "Todo not found" }, 404);
    }

    return context.body(null, 204);
  });

export type AppType = typeof routes;

export { app };

function readLabelLimit(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

async function delay(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
