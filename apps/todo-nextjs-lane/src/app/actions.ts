"use server";

import { revalidatePath } from "next/cache";
import type { Todo } from "@lane/todo-api";
import { createTodo, deleteTodo, updateTodo } from "./todo-api";

export type TodoActionState = {
  error: string | null;
  submissionId: number;
};

export type ToggleTodoActionResult =
  | {
      ok: true;
      todo: Todo;
    }
  | {
      ok: false;
      error: string;
    };

export async function createTodoAction(
  previousState: TodoActionState,
  formData: FormData,
): Promise<TodoActionState> {
  const title = readRequiredString(formData, "title");

  if (!title) {
    return {
      error: "Title is required",
      submissionId: previousState.submissionId,
    };
  }

  try {
    await createTodo({ title });
    revalidatePath("/");
    return {
      error: null,
      submissionId: previousState.submissionId + 1,
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      submissionId: previousState.submissionId,
    };
  }
}

export async function refreshTodosAction() {
  revalidatePath("/");
}

export async function toggleTodoAction(
  id: string,
  completed: boolean,
): Promise<ToggleTodoActionResult> {
  if (!id) {
    return {
      ok: false,
      error: "Todo id is required",
    };
  }

  try {
    const todo = await updateTodo(id, { completed });
    return {
      ok: true,
      todo,
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error),
    };
  }
}

export async function deleteTodoAction(id: string) {
  if (!id) {
    return;
  }

  await deleteTodo(id);
  revalidatePath("/");
}

function readRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
