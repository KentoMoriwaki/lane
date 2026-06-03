"use server";

import { revalidatePath } from "next/cache";
import { createTodo, deleteTodo, updateTodo } from "./todo-api";

export type TodoActionState = {
  error: string | null;
  submissionId: number;
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

export async function toggleTodoAction(id: string, completed: boolean) {
  if (!id) {
    return;
  }

  await updateTodo(id, { completed });
  revalidatePath("/");
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
