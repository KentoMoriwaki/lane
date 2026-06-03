import type { AppType } from "@lane/todo-api";
import { hc } from "hono/client";

const apiUrl = process.env.TODO_API_URL ?? "http://localhost:4000";
const client = hc<AppType>(apiUrl);
const requestOptions = {
  init: {
    cache: "no-store",
  },
} satisfies Parameters<typeof client.todos.$get>[1];

type UpdateTodoInput = NonNullable<
  Parameters<(typeof client.todos)[":id"]["$patch"]>[0]
>["json"];

export async function listTodos() {
  const response = await client.todos.$get(undefined, requestOptions);
  await assertOk(response);
  return response.json();
}

export async function createTodo(input: { title: string }) {
  const response = await client.todos.$post(
    {
      json: input,
    },
    requestOptions,
  );
  await assertOk(response);
  return response.json();
}

export async function updateTodo(id: string, input: UpdateTodoInput) {
  const response = await client.todos[":id"].$patch(
    {
      json: input,
      param: { id },
    },
    requestOptions,
  );
  await assertOk(response);
  return response.json();
}

export async function deleteTodo(id: string): Promise<void> {
  const response = await client.todos[":id"].$delete(
    {
      param: { id },
    },
    requestOptions,
  );
  await assertOk(response);
}

async function assertOk(response: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}) {
  if (response.ok) {
    return;
  }

  const fallback = `Request failed with ${response.status}`;
  const body = await response.text();

  if (!body) {
    throw new Error(fallback);
  }

  let data: { error?: unknown } | null = null;

  try {
    data = JSON.parse(body) as { error?: unknown };
  } catch {
    // Keep the raw response body for non-JSON errors.
  }

  if (typeof data?.error === "string") {
    throw new Error(data.error);
  }

  throw new Error(body);
}
