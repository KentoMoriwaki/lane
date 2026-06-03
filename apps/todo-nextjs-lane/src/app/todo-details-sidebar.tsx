import type { Todo } from "@lane/todo-api";
import { TodoDetailControls } from "./todo-controls";

export function TodoDetailsSidebar({ todo }: { todo: Todo | null }) {
  if (!todo) {
    return (
      <aside className="details-sidebar">
        <div className="details-empty">Select a task.</div>
      </aside>
    );
  }

  return (
    <aside className="details-sidebar">
      <TodoDetailControls key={todo.id} todo={todo} />
    </aside>
  );
}
