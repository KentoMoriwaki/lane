import { TodoApp } from "./todo-app";
import { listTodos } from "./todo-api";

export default async function Page() {
  const todos = await listTodos();

  return <TodoApp todos={todos} />;
}
