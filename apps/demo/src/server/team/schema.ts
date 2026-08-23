import { z } from "zod";

/**
 * Domain enums for the team task workspace.
 *
 * These are intentionally small but expressive enough to exercise the product
 * requirements: grouped statuses, prioritised work, and assignable tasks.
 */
export const taskStatusValues = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

export const taskPriorityValues = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const memberRoleValues = ["admin", "member"] as const;

export const taskStatusSchema = z.enum(taskStatusValues);
export const taskPrioritySchema = z.enum(taskPriorityValues);
export const memberRoleSchema = z.enum(memberRoleValues);

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  initials: z.string(),
  color: z.string(),
});

export const currentUserSchema = userSchema.extend({
  defaultTeamId: z.string(),
});

export const teamSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: memberRoleSchema,
  memberCount: z.number(),
});

export const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  initials: z.string(),
  color: z.string(),
  role: memberRoleSchema,
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  color: z.string(),
  taskCount: z.number(),
});

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export const taskSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  title: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assignee: memberSchema.nullable(),
  project: projectSchema.nullable(),
  labels: z.array(labelSchema),
  dueDate: z.string().nullable(),
  /** IDs of tasks this task is blocked by (read-only; seeded). */
  blockedBy: z.array(z.string()),
  /** IDs of tasks this task blocks — the reverse edges (read-only; computed). */
  blocks: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const insightsSchema = z.object({
  total: z.number(),
  open: z.number(),
  inProgress: z.number(),
  inReview: z.number(),
  completed: z.number(),
  overdue: z.number(),
  unassigned: z.number(),
  assignedToMe: z.number(),
  dueSoon: z.number(),
  byStatus: z.record(taskStatusSchema, z.number()),
});

/* ------------------------------- Inputs -------------------------------- */

export const taskScopeValues = ["all", "mine", "unassigned"] as const;
export const taskScopeSchema = z.enum(taskScopeValues);

export const listTasksQuerySchema = z.object({
  q: z.string().optional(),
  scope: taskScopeSchema.optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  projectId: z.string().optional(),
  labelId: z.string().optional(),
  due: z.enum(["overdue", "today", "week"]).optional(),
  /** Comma-separated task IDs — used to resolve dependency edges. */
  ids: z.string().optional(),
  /**
   * How many rows to serve. Absent means the endpoint's own page size; a
   * caller that wants the whole list asks for the ceiling. Kept as a string so
   * the RPC client's query type stays the plain `Record<string, string>` every
   * caller already builds — the route parses it.
   */
  limit: z.string().optional(),
  /** Where to continue from: an opaque cursor from a previous page. */
  cursor: z.string().optional(),
});

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const updateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const createLabelInputSchema = z.object({
  name: z.string().trim().min(1).max(48),
  color: z.string().trim().optional(),
});

export const addTaskLabelInputSchema = z.object({
  labelId: z.string().min(1),
});

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(6).optional(),
  color: z.string().trim().optional(),
});

export const listMembersQuerySchema = z.object({
  q: z.string().optional(),
});

export const listLabelsQuerySchema = z.object({
  q: z.string().optional(),
});

/* ------------------------------- Types --------------------------------- */

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type TeamUser = z.infer<typeof userSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type TeamSummary = z.infer<typeof teamSummarySchema>;
export type TeamMember = z.infer<typeof memberSchema>;
export type Project = z.infer<typeof projectSchema>;
export type TeamLabel = z.infer<typeof labelSchema>;
export type Task = z.infer<typeof taskSchema>;

/**
 * The sort key a task occupies in every listing of tasks: closed last, then
 * priority, then status, then age, and finally the id.
 *
 * The id is not decoration. Two tasks created in the same millisecond used to
 * compare "after" in both directions, which is a comparator without a total
 * order — fine for painting a screen, useless as the thing a cursor names. With
 * it, "the row after this one" has exactly one answer, and that is what a page
 * cursor continues from.
 */
export type TaskSortKey = {
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  id: string;
};

/** One page of the task list, and where the next one starts. */
export type TaskPage = {
  items: Task[];
  nextCursor: string | null;
};
export type Insights = z.infer<typeof insightsSchema>;
export type TaskScope = z.infer<typeof taskScopeSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
