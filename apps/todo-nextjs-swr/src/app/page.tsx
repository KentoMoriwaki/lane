import { SWRConfig } from "swr";
import { TodoApp } from "./todo-app";
import { listTodos, todosKey } from "./todo-api";

export default async function Page() {
  const todos = await listTodos();

  return (
    <SWRConfig
      value={{
        fallback: {
          [todosKey]: todos,
        },
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnMount: false,
        revalidateOnReconnect: false,
        shouldRetryOnError: true,
      }}
    >
      <TodoApp />
    </SWRConfig>
  );
}
