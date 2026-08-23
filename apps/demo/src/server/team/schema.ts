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
});

/**
 * The cursor-paginated task list (`GET /api/task-pages`).
 *
 * Added for the hybrid-ownership spike in `app/lane-infinite`: the App Router
 * publishes page 1 and the browser walks pages 2..N from the same endpoint, so
 * both halves have to be able to ask for a page by cursor. The cursor is
 * keyset — the id of the last row of the previous page — because that is the
 * only kind that survives a row being inserted above it, which is exactly what
 * the spike's "create a task, republish, re-walk" flow does.
 */
export const listTaskPageQuerySchema = z.object({
  /** The id of the last row of the previous page. Absent means "first page". */
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(4),
  scope: taskScopeSchema.optional(),
  status: z.string().optional(),
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
export type Insights = z.infer<typeof insightsSchema>;
export type TaskScope = z.infer<typeof taskScopeSchema>;

/**
 * One page of the cursor-paginated task list — the `P` of the hybrid infinite
 * lane in `app/lane-infinite`.
 *
 * `servedAt` / `serveSeq` are the provenance the spike is measured with: every
 * response is stamped when it is served, so the client can say *which* server
 * response it is looking at. That is what makes "the re-walk adopted the fresh
 * publication, not a stale closure" a fact rather than an inference.
 */
export type TaskPage = {
  items: Task[];
  /** The id of the last row on this page, or `null` at the end of the list. */
  nextCursor: string | null;
  /** 1-based, derived on the server from the cursor it was handed. */
  pageIndex: number;
  requestedCursor: string | null;
  /**
   * **The content identity of this page** — a hash of everything about it that
   * a reader could render: the rows (id + `updatedAt`), the cursor out of it,
   * and the total. Stable when the page comes back unchanged, different the
   * moment any of it moves.
   *
   * It exists because the client keys its infinite entry on it: a republication
   * that changed page 1 is a *new list*, and a new key is how you say that
   * without an effect. The owner is the only party that can compute this
   * honestly, which is the whole reason it is a wire field rather than
   * something the browser derives — a client comparing two deserialized RSC
   * payloads has no reference equality to work with, and Lane's own `revision`
   * for a published key names the publication, not the content.
   *
   * Deliberately *not* covering `servedAt` / `serveSeq`: those are provenance,
   * not content. Two serves of identical rows must hash the same or the whole
   * mechanism inverts into "re-key on every refresh".
   */
  version: string;
  servedAt: string;
  serveSeq: number;
  total: number;
};

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
