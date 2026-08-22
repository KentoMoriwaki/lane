import type { UpdateTaskInput } from "@/server/team/schema";

export type TaskUpdateDerivedImpact = {
  insights: boolean;
  projects: boolean;
};

/**
 * Derived cache domains affected by an in-place task update.
 *
 * Task lists and the selected task always change. Insights read task status,
 * assignee, and due date; project counts read only the project assignment.
 * Keeping this dependency matrix pure makes the invalidation policy easy to
 * lock down without coupling the test to Next's cache implementation.
 */
export function getTaskUpdateDerivedImpact(
  input: UpdateTaskInput,
): TaskUpdateDerivedImpact {
  return {
    insights:
      input.status !== undefined ||
      input.assigneeId !== undefined ||
      input.dueDate !== undefined,
    projects: input.projectId !== undefined,
  };
}
