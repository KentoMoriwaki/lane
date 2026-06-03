import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  createTodo,
  deleteTodo,
  listTodos,
  updateTodo,
} from "./db.js";

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
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

export type Todo = z.infer<typeof todoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoInputSchema>;

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

export const routes = app
  .get("/health", (context) => context.json({ ok: true }, 200))
  .get("/todos", (context) => context.json(listTodos(), 200))
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
  .delete("/todos/:id", (context) => {
    const deleted = deleteTodo(context.req.param("id"));

    if (!deleted) {
      return context.json({ error: "Todo not found" }, 404);
    }

    return context.body(null, 204);
  });

export type AppType = typeof routes;

export { app };
