import type { Todo, UpdateTodoInput } from "@lane/todo-api";

const apiUrl = process.env.NEXT_PUBLIC_TODO_API_URL ?? "http://localhost:4000";

export const todosKey = "/todos";

export async function listTodos(): Promise<Todo[]> {
  const response = await fetch(`${apiUrl}/todos`, {
    cache: "no-store",
  });
  await assertOk(response);
  return response.json();
}

export async function createTodo(input: { title: string }): Promise<Todo> {
  const response = await fetch(`${apiUrl}/todos`, {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  await assertOk(response);
  return response.json();
}

export async function updateTodo(
  id: string,
  input: UpdateTodoInput,
): Promise<Todo> {
  const response = await fetch(`${apiUrl}/todos/${id}`, {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      "content-type": "application/json",
    },
    method: "PATCH",
  });
  await assertOk(response);
  return response.json();
}

export async function deleteTodo(id: string): Promise<void> {
  const response = await fetch(`${apiUrl}/todos/${id}`, {
    cache: "no-store",
    method: "DELETE",
  });
  await assertOk(response);
}

async function assertOk(response: Response) {
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
