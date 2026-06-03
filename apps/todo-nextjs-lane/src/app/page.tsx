import { TodoApp } from "./todo-app";
import { TodoDetailsSidebar } from "./todo-details-sidebar";
import { listTodos } from "./todo-api";

type PageProps = {
  searchParams?: Promise<{
    todoId?: string | string[];
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedTodoId = readSingleParam(params?.todoId);
  const todos = await listTodos();
  const selectedTodo =
    todos.find((todo) => todo.id === selectedTodoId) ?? null;

  return (
    <TodoApp
      selectedTodoId={selectedTodoId}
      sidebar={<TodoDetailsSidebar todo={selectedTodo} />}
      todos={todos}
    />
  );
}

function readSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? null;
}
