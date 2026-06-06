"use server";

import { revalidatePath } from "next/cache";
import type { Todo } from "@lane/todo-api";
import {
  assignTodoLabel,
  createTodo,
  deleteTodo,
  removeTodoLabel,
  updateTodo,
} from "./todo-api";

export type TodoActionState = {
  error: string | null;
  submissionId: number;
};

export type TodoMutationActionResult =
  | {
      ok: true;
      todo: Todo;
    }
  | {
      ok: false;
      error: string;
    };

export type TaskLabelMutation =
  | {
      type: "assign";
      labelId: string;
    }
  | {
      type: "remove";
      labelId: string;
    };

export type TaskLabelMutationActionResult =
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
): Promise<TodoMutationActionResult> {
  if (!id) {
    return {
      ok: false,
      error: "Todo id is required",
    };
  }

  try {
    const todo = await updateTodo(id, { completed });
    revalidatePath("/");
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

export async function updateTodoTitleAction(
  id: string,
  title: string,
): Promise<TodoMutationActionResult> {
  if (!id) {
    return {
      ok: false,
      error: "Todo id is required",
    };
  }

  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    return {
      ok: false,
      error: "Title is required",
    };
  }

  try {
    const todo = await updateTodo(id, { title: trimmedTitle });
    revalidatePath("/");
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

export async function changeTodoLabelsAction(
  id: string,
  mutation: TaskLabelMutation,
): Promise<TaskLabelMutationActionResult> {
  if (!id) {
    return {
      ok: false,
      error: "Todo id is required",
    };
  }

  if (!mutation.labelId) {
    return {
      ok: false,
      error: "Label id is required",
    };
  }

  try {
    const todo =
      mutation.type === "assign"
        ? await assignTodoLabel(id, mutation.labelId)
        : await removeTodoLabel(id, mutation.labelId);

    revalidatePath("/");
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
