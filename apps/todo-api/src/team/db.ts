import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  CurrentUser,
  Insights,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  TeamLabel,
  TeamMember,
  TeamSummary,
  TeamUser,
  UpdateTaskInput,
} from "./schema.js";

const dbPath = resolve(process.env.TEAM_DB_PATH ?? "data/team-task.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  pragma foreign_keys = on;

  create table if not exists users (
    id text primary key,
    name text not null,
    email text not null,
    initials text not null,
    color text not null
  );

  create table if not exists teams (
    id text primary key,
    name text not null,
    slug text not null
  );

  create table if not exists team_members (
    team_id text not null,
    user_id text not null,
    role text not null,
    primary key (team_id, user_id),
    foreign key (team_id) references teams(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade
  );

  create table if not exists projects (
    id text primary key,
    team_id text not null,
    name text not null,
    key text not null,
    color text not null,
    created_at text not null,
    foreign key (team_id) references teams(id) on delete cascade
  );

  create table if not exists labels (
    id text primary key,
    team_id text not null,
    name text not null,
    color text not null,
    created_at text not null,
    foreign key (team_id) references teams(id) on delete cascade
  );

  create table if not exists tasks (
    id text primary key,
    team_id text not null,
    title text not null,
    description text not null default '',
    status text not null,
    priority text not null,
    assignee_id text,
    project_id text,
    due_date text,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    foreign key (team_id) references teams(id) on delete cascade
  );

  create table if not exists task_labels (
    task_id text not null,
    label_id text not null,
    primary key (task_id, label_id),
    foreign key (task_id) references tasks(id) on delete cascade,
    foreign key (label_id) references labels(id) on delete cascade
  );
`);

/* --------------------------------- Rows -------------------------------- */

type UserRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
};

type MemberRow = UserRow & { role: string };

type ProjectRow = {
  id: string;
  team_id: string;
  name: string;
  key: string;
  color: string;
  created_at: string;
};

type LabelRow = {
  id: string;
  team_id: string;
  name: string;
  color: string;
  created_at: string;
};

type TaskRow = {
  id: string;
  team_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  project_id: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_USER_ID = "u_maya";

seed();

/* --------------------------------- Seed -------------------------------- */

function seed() {
  const existing = db.prepare("select count(*) as count from teams").get() as {
    count: number;
  };

  if (existing.count > 0) {
    return;
  }

  const base = Date.now();
  const day = 86_400_000;
  const at = (offsetDays: number) =>
    new Date(base + offsetDays * day).toISOString();

  const users: TeamUser[] = [
    { id: "u_maya", name: "Maya Chen", email: "maya@acme.test", initials: "MC", color: "cobalt" },
    { id: "u_arjun", name: "Arjun Patel", email: "arjun@acme.test", initials: "AP", color: "sage" },
    { id: "u_sofia", name: "Sofia Reyes", email: "sofia@acme.test", initials: "SR", color: "rose" },
    { id: "u_leo", name: "Leo Schmidt", email: "leo@acme.test", initials: "LS", color: "amber" },
    { id: "u_nina", name: "Nina Owens", email: "nina@acme.test", initials: "NO", color: "slate" },
  ];

  for (const user of users) {
    db.prepare(
      "insert into users (id, name, email, initials, color) values (?, ?, ?, ?, ?)",
    ).run(user.id, user.name, user.email, user.initials, user.color);
  }

  const teams = [
    { id: "t_acme", name: "Acme Product Team", slug: "acme" },
    { id: "t_growth", name: "Growth Pod", slug: "growth" },
  ];

  for (const team of teams) {
    db.prepare("insert into teams (id, name, slug) values (?, ?, ?)").run(
      team.id,
      team.name,
      team.slug,
    );
  }

  const memberships: Array<[string, string, string]> = [
    ["t_acme", "u_maya", "admin"],
    ["t_acme", "u_arjun", "member"],
    ["t_acme", "u_sofia", "member"],
    ["t_acme", "u_leo", "member"],
    ["t_growth", "u_nina", "admin"],
    ["t_growth", "u_maya", "member"],
    ["t_growth", "u_sofia", "member"],
  ];

  for (const [teamId, userId, role] of memberships) {
    db.prepare(
      "insert into team_members (team_id, user_id, role) values (?, ?, ?)",
    ).run(teamId, userId, role);
  }

  const projects: Array<Omit<ProjectRow, "created_at"> & { offset: number }> = [
    { id: "p_billing", team_id: "t_acme", name: "Billing", key: "BIL", color: "cobalt", offset: -40 },
    { id: "p_onboarding", team_id: "t_acme", name: "Onboarding", key: "ONB", color: "sage", offset: -38 },
    { id: "p_platform", team_id: "t_acme", name: "Platform", key: "PLT", color: "amber", offset: -30 },
    { id: "p_lifecycle", team_id: "t_growth", name: "Lifecycle", key: "LIF", color: "rose", offset: -20 },
    { id: "p_experiments", team_id: "t_growth", name: "Experiments", key: "EXP", color: "cobalt", offset: -18 },
  ];

  for (const project of projects) {
    db.prepare(
      "insert into projects (id, team_id, name, key, color, created_at) values (?, ?, ?, ?, ?, ?)",
    ).run(project.id, project.team_id, project.name, project.key, project.color, at(project.offset));
  }

  const labels: Array<Omit<LabelRow, "created_at"> & { offset: number }> = [
    { id: "l_bug", team_id: "t_acme", name: "bug", color: "rose", offset: -40 },
    { id: "l_backend", team_id: "t_acme", name: "backend", color: "cobalt", offset: -40 },
    { id: "l_frontend", team_id: "t_acme", name: "frontend", color: "sage", offset: -40 },
    { id: "l_research", team_id: "t_acme", name: "research", color: "amber", offset: -40 },
    { id: "l_blocked", team_id: "t_acme", name: "blocked", color: "rose", offset: -40 },
    { id: "l_seo", team_id: "t_growth", name: "seo", color: "sage", offset: -20 },
    { id: "l_email", team_id: "t_growth", name: "email", color: "cobalt", offset: -20 },
  ];

  for (const label of labels) {
    db.prepare(
      "insert into labels (id, team_id, name, color, created_at) values (?, ?, ?, ?, ?)",
    ).run(label.id, label.team_id, label.name, label.color, at(label.offset));
  }

  type SeedTask = {
    id: string;
    teamId: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
    projectId: string | null;
    dueOffset: number | null;
    createdOffset: number;
    labelIds: string[];
  };

  const tasks: SeedTask[] = [
    {
      id: "task_webhook",
      teamId: "t_acme",
      title: "Review billing webhook retry behavior",
      description:
        "Payments are occasionally double-charged when Stripe retries a webhook. Audit the idempotency keys and confirm the retry window.",
      status: "in_progress",
      priority: "urgent",
      assigneeId: "u_maya",
      projectId: "p_billing",
      dueOffset: -1,
      createdOffset: -9,
      labelIds: ["l_bug", "l_backend"],
    },
    {
      id: "task_invoice_pdf",
      teamId: "t_acme",
      title: "Generate downloadable invoice PDFs",
      description: "Add a server route that renders invoices as PDF and exposes a download link from the billing page.",
      status: "todo",
      priority: "high",
      assigneeId: "u_arjun",
      projectId: "p_billing",
      dueOffset: 3,
      createdOffset: -8,
      labelIds: ["l_backend"],
    },
    {
      id: "task_dunning",
      teamId: "t_acme",
      title: "Dunning emails for failed payments",
      description: "Send a sequence of reminder emails when a subscription payment fails before downgrading the plan.",
      status: "backlog",
      priority: "medium",
      assigneeId: null,
      projectId: "p_billing",
      dueOffset: 12,
      createdOffset: -7,
      labelIds: [],
    },
    {
      id: "task_onboarding_checklist",
      teamId: "t_acme",
      title: "Interactive onboarding checklist",
      description: "Replace the static welcome page with a checklist that tracks first-run milestones per workspace.",
      status: "in_review",
      priority: "high",
      assigneeId: "u_sofia",
      projectId: "p_onboarding",
      dueOffset: 1,
      createdOffset: -10,
      labelIds: ["l_frontend"],
    },
    {
      id: "task_empty_states",
      teamId: "t_acme",
      title: "Design calmer empty states",
      description: "Empty list states feel abrupt. Add illustration-free guidance with a single clear next action.",
      status: "todo",
      priority: "low",
      assigneeId: "u_sofia",
      projectId: "p_onboarding",
      dueOffset: 9,
      createdOffset: -6,
      labelIds: ["l_frontend"],
    },
    {
      id: "task_sso",
      teamId: "t_acme",
      title: "SSO sign-in for enterprise workspaces",
      description: "Support SAML based single sign-on. Start with Okta and document the metadata exchange.",
      status: "in_progress",
      priority: "high",
      assigneeId: "u_leo",
      projectId: "p_platform",
      dueOffset: 5,
      createdOffset: -11,
      labelIds: ["l_backend", "l_research"],
    },
    {
      id: "task_audit_log",
      teamId: "t_acme",
      title: "Workspace audit log",
      description: "Record security-relevant events (sign-in, role changes, billing edits) and expose them to admins.",
      status: "backlog",
      priority: "medium",
      assigneeId: null,
      projectId: "p_platform",
      dueOffset: null,
      createdOffset: -5,
      labelIds: ["l_research"],
    },
    {
      id: "task_flaky_test",
      teamId: "t_acme",
      title: "Fix flaky task-list integration test",
      description: "The task list test fails intermittently in CI because of an unmocked timer. Stabilise it.",
      status: "todo",
      priority: "medium",
      assigneeId: "u_arjun",
      projectId: "p_platform",
      dueOffset: -3,
      createdOffset: -4,
      labelIds: ["l_bug", "l_blocked"],
    },
    {
      id: "task_keyboard",
      teamId: "t_acme",
      title: "Keyboard shortcuts for task triage",
      description: "Add j/k navigation and quick status changes so power users can triage without the mouse.",
      status: "todo",
      priority: "low",
      assigneeId: "u_maya",
      projectId: null,
      dueOffset: 14,
      createdOffset: -3,
      labelIds: ["l_frontend"],
    },
    {
      id: "task_usage_dashboard",
      teamId: "t_acme",
      title: "Usage metering dashboard",
      description: "Show per-workspace API usage with a daily breakdown so customers can predict their bill.",
      status: "in_progress",
      priority: "medium",
      assigneeId: "u_leo",
      projectId: "p_billing",
      dueOffset: 6,
      createdOffset: -3,
      labelIds: ["l_frontend", "l_backend"],
    },
    {
      id: "task_mobile_nav",
      teamId: "t_acme",
      title: "Responsive navigation for small screens",
      description: "The left navigation overlaps content under 900px. Collapse it into a sheet on small screens.",
      status: "done",
      priority: "medium",
      assigneeId: "u_sofia",
      projectId: "p_onboarding",
      dueOffset: -6,
      createdOffset: -14,
      labelIds: ["l_frontend"],
    },
    {
      id: "task_rate_limit",
      teamId: "t_acme",
      title: "Per-token rate limiting",
      description: "Protect the public API with a sliding-window rate limiter keyed by token.",
      status: "done",
      priority: "high",
      assigneeId: "u_leo",
      projectId: "p_platform",
      dueOffset: -8,
      createdOffset: -16,
      labelIds: ["l_backend"],
    },
    {
      id: "task_canceled_export",
      teamId: "t_acme",
      title: "CSV export of billing history",
      description: "Superseded by the invoice PDF work. Kept for reference.",
      status: "canceled",
      priority: "low",
      assigneeId: null,
      projectId: "p_billing",
      dueOffset: null,
      createdOffset: -15,
      labelIds: [],
    },
    {
      id: "task_proration",
      teamId: "t_acme",
      title: "Mid-cycle plan proration",
      description: "When a customer upgrades mid-cycle, charge a prorated amount and adjust the next invoice.",
      status: "todo",
      priority: "urgent",
      assigneeId: "u_maya",
      projectId: "p_billing",
      dueOffset: 2,
      createdOffset: -2,
      labelIds: ["l_backend"],
    },
    {
      id: "task_a11y",
      teamId: "t_acme",
      title: "Accessibility pass on the task detail panel",
      description: "Audit focus order, labels, and contrast in the right detail panel.",
      status: "backlog",
      priority: "low",
      assigneeId: null,
      projectId: "p_onboarding",
      dueOffset: null,
      createdOffset: -1,
      labelIds: ["l_frontend", "l_research"],
    },
    {
      id: "task_search",
      teamId: "t_acme",
      title: "Server-side task search",
      description: "Move keyword search to the API so large workspaces stay responsive.",
      status: "in_review",
      priority: "medium",
      assigneeId: "u_arjun",
      projectId: "p_platform",
      dueOffset: 4,
      createdOffset: -2,
      labelIds: ["l_backend"],
    },
    {
      id: "task_growth_welcome",
      teamId: "t_growth",
      title: "Welcome email rewrite",
      description: "Rewrite the day-zero welcome email with a single clear call to action.",
      status: "in_progress",
      priority: "high",
      assigneeId: "u_nina",
      projectId: "p_lifecycle",
      dueOffset: 1,
      createdOffset: -6,
      labelIds: ["l_email"],
    },
    {
      id: "task_growth_seo",
      teamId: "t_growth",
      title: "SEO audit of the docs site",
      description: "Find pages with thin content and missing metadata, then prioritise rewrites.",
      status: "todo",
      priority: "medium",
      assigneeId: "u_sofia",
      projectId: "p_lifecycle",
      dueOffset: 7,
      createdOffset: -5,
      labelIds: ["l_seo"],
    },
    {
      id: "task_growth_ab",
      teamId: "t_growth",
      title: "Pricing page A/B test",
      description: "Test a value-first pricing layout against the current feature-grid layout.",
      status: "backlog",
      priority: "high",
      assigneeId: null,
      projectId: "p_experiments",
      dueOffset: -2,
      createdOffset: -4,
      labelIds: [],
    },
    {
      id: "task_growth_referral",
      teamId: "t_growth",
      title: "Double-sided referral program",
      description: "Reward both the referrer and the referred workspace once the referred team activates.",
      status: "todo",
      priority: "medium",
      assigneeId: "u_maya",
      projectId: "p_experiments",
      dueOffset: 10,
      createdOffset: -3,
      labelIds: ["l_email"],
    },
  ];

  for (const task of tasks) {
    const createdAt = at(task.createdOffset);
    db.prepare(
      `insert into tasks (
        id, team_id, title, description, status, priority,
        assignee_id, project_id, due_date, created_by, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      task.id,
      task.teamId,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assigneeId,
      task.projectId,
      task.dueOffset === null ? null : at(task.dueOffset),
      "u_maya",
      createdAt,
      createdAt,
    );

    for (const labelId of task.labelIds) {
      db.prepare(
        "insert into task_labels (task_id, label_id) values (?, ?)",
      ).run(task.id, labelId);
    }
  }
}

/* ------------------------------ Assemblers ----------------------------- */

function toUser(row: UserRow): TeamUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    initials: row.initials,
    color: row.color,
  };
}

function toMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    initials: row.initials,
    color: row.color,
    role: row.role as TeamMember["role"],
  };
}

function toProject(row: ProjectRow): Project {
  const count = db
    .prepare("select count(*) as count from tasks where project_id = ?")
    .get(row.id) as { count: number };

  return {
    id: row.id,
    name: row.name,
    key: row.key,
    color: row.color,
    taskCount: count.count,
  };
}

function toLabel(row: LabelRow): TeamLabel {
  return { id: row.id, name: row.name, color: row.color };
}

function labelsForTask(taskId: string): TeamLabel[] {
  const rows = db
    .prepare(
      `select labels.* from labels
       inner join task_labels on task_labels.label_id = labels.id
       where task_labels.task_id = ?
       order by labels.name asc`,
    )
    .all(taskId) as LabelRow[];

  return rows.map(toLabel);
}

function memberForTask(teamId: string, userId: string | null): TeamMember | null {
  if (!userId) {
    return null;
  }

  const row = db
    .prepare(
      `select users.*, team_members.role as role from users
       inner join team_members on team_members.user_id = users.id
       where users.id = ? and team_members.team_id = ?`,
    )
    .get(userId, teamId) as MemberRow | undefined;

  return row ? toMember(row) : null;
}

function projectForTask(projectId: string | null): Project | null {
  if (!projectId) {
    return null;
  }

  const row = db
    .prepare("select * from projects where id = ?")
    .get(projectId) as ProjectRow | undefined;

  return row ? toProject(row) : null;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assignee: memberForTask(row.team_id, row.assignee_id),
    project: projectForTask(row.project_id),
    labels: labelsForTask(row.id),
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------- Session ------------------------------- */

export function getUserById(id: string): TeamUser | null {
  const row = db.prepare("select * from users where id = ?").get(id) as
    | UserRow
    | undefined;

  return row ? toUser(row) : null;
}

export function getCurrentUser(userId: string): CurrentUser | null {
  const user = getUserById(userId);

  if (!user) {
    return null;
  }

  const teams = listTeamsForUser(userId);
  const defaultTeamId = teams[0]?.id ?? "";

  return { ...user, defaultTeamId };
}

export function listTeamsForUser(userId: string): TeamSummary[] {
  const rows = db
    .prepare(
      `select teams.id, teams.name, teams.slug, team_members.role as role
       from teams
       inner join team_members on team_members.team_id = teams.id
       where team_members.user_id = ?
       order by teams.name asc`,
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;

  return rows.map((row) => {
    const count = db
      .prepare("select count(*) as count from team_members where team_id = ?")
      .get(row.id) as { count: number };

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: row.role as TeamSummary["role"],
      memberCount: count.count,
    };
  });
}

export function getMembershipRole(
  teamId: string,
  userId: string,
): TeamMember["role"] | null {
  const row = db
    .prepare(
      "select role from team_members where team_id = ? and user_id = ?",
    )
    .get(teamId, userId) as { role: string } | undefined;

  return row ? (row.role as TeamMember["role"]) : null;
}

/* ------------------------------ Reference ------------------------------ */

export function listMembers(teamId: string, q: string): TeamMember[] {
  const trimmed = q.trim().toLowerCase();
  const rows = db
    .prepare(
      `select users.*, team_members.role as role from users
       inner join team_members on team_members.user_id = users.id
       where team_members.team_id = ?
       order by users.name asc`,
    )
    .all(teamId) as MemberRow[];

  const members = rows.map(toMember);

  if (!trimmed) {
    return members;
  }

  return members.filter(
    (member) =>
      member.name.toLowerCase().includes(trimmed) ||
      member.email.toLowerCase().includes(trimmed),
  );
}

export function listProjects(teamId: string): Project[] {
  const rows = db
    .prepare("select * from projects where team_id = ? order by name asc")
    .all(teamId) as ProjectRow[];

  return rows.map(toProject);
}

export function createProject(
  teamId: string,
  input: CreateProjectInput,
): Project {
  const id = `p_${nanoid(8)}`;
  const key =
    input.key?.toUpperCase() ?? input.name.slice(0, 3).toUpperCase();
  const color = input.color ?? "slate";

  db.prepare(
    "insert into projects (id, team_id, name, key, color, created_at) values (?, ?, ?, ?, ?, ?)",
  ).run(id, teamId, input.name, key, color, new Date().toISOString());

  return toProject(
    db.prepare("select * from projects where id = ?").get(id) as ProjectRow,
  );
}

export function listLabels(teamId: string, q: string): TeamLabel[] {
  const trimmed = q.trim().toLowerCase();
  const rows = db
    .prepare("select * from labels where team_id = ? order by name asc")
    .all(teamId) as LabelRow[];

  const labels = rows.map(toLabel);

  if (!trimmed) {
    return labels;
  }

  return labels.filter((label) => label.name.toLowerCase().includes(trimmed));
}

export function createLabel(
  teamId: string,
  input: CreateLabelInput,
): TeamLabel {
  const existing = db
    .prepare(
      "select * from labels where team_id = ? and name = ? collate nocase",
    )
    .get(teamId, input.name) as LabelRow | undefined;

  if (existing) {
    return toLabel(existing);
  }

  const id = `l_${nanoid(8)}`;
  const color = input.color ?? pickLabelColor(teamId);

  db.prepare(
    "insert into labels (id, team_id, name, color, created_at) values (?, ?, ?, ?, ?)",
  ).run(id, teamId, input.name, color, new Date().toISOString());

  return toLabel(
    db.prepare("select * from labels where id = ?").get(id) as LabelRow,
  );
}

const labelPalette = ["sage", "cobalt", "rose", "amber", "slate"];

function pickLabelColor(teamId: string): string {
  const count = db
    .prepare("select count(*) as count from labels where team_id = ?")
    .get(teamId) as { count: number };

  return labelPalette[count.count % labelPalette.length] ?? "slate";
}

/* -------------------------------- Tasks -------------------------------- */

export type TaskFilters = {
  q?: string;
  scope?: "all" | "mine" | "unassigned";
  status?: string;
  priority?: string;
  projectId?: string;
  labelId?: string;
  due?: "overdue" | "today" | "week";
};

const statusOrder: Record<TaskStatus, number> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  canceled: 5,
};

const priorityOrder: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function listTasks(
  teamId: string,
  currentUserId: string,
  filters: TaskFilters,
): Task[] {
  const rows = db
    .prepare("select * from tasks where team_id = ?")
    .all(teamId) as TaskRow[];

  let tasks = rows.map(toTask);

  const statusFilter = parseCsv(filters.status);
  if (statusFilter.length > 0) {
    tasks = tasks.filter((task) => statusFilter.includes(task.status));
  }

  const priorityFilter = parseCsv(filters.priority);
  if (priorityFilter.length > 0) {
    tasks = tasks.filter((task) => priorityFilter.includes(task.priority));
  }

  if (filters.projectId) {
    tasks = tasks.filter((task) => task.project?.id === filters.projectId);
  }

  if (filters.labelId) {
    tasks = tasks.filter((task) =>
      task.labels.some((label) => label.id === filters.labelId),
    );
  }

  if (filters.scope === "mine") {
    tasks = tasks.filter((task) => task.assignee?.id === currentUserId);
  } else if (filters.scope === "unassigned") {
    tasks = tasks.filter((task) => task.assignee === null);
  }

  if (filters.due) {
    const now = Date.now();
    const week = now + 7 * 86_400_000;
    tasks = tasks.filter((task) => {
      if (!task.dueDate) {
        return false;
      }
      const due = new Date(task.dueDate).getTime();
      if (filters.due === "overdue") {
        return due < now && !isClosed(task.status);
      }
      if (filters.due === "today") {
        return sameDay(due, now);
      }
      return due >= now && due <= week;
    });
  }

  const query = filters.q?.trim().toLowerCase();
  if (query) {
    tasks = tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(query) ||
        task.description.toLowerCase().includes(query) ||
        task.labels.some((label) => label.name.toLowerCase().includes(query)),
    );
  }

  return tasks.sort((a, b) => {
    const closedDiff = Number(isClosed(a.status)) - Number(isClosed(b.status));
    if (closedDiff !== 0) {
      return closedDiff;
    }
    const priorityDiff =
      priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

export function getTask(teamId: string, taskId: string): Task | null {
  const row = db
    .prepare("select * from tasks where id = ? and team_id = ?")
    .get(taskId, teamId) as TaskRow | undefined;

  return row ? toTask(row) : null;
}

export function createTask(
  teamId: string,
  createdById: string,
  input: CreateTaskInput,
): Task {
  const now = new Date().toISOString();
  const id = `task_${nanoid(10)}`;

  db.prepare(
    `insert into tasks (
      id, team_id, title, description, status, priority,
      assignee_id, project_id, due_date, created_by, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    teamId,
    input.title,
    input.description ?? "",
    input.status ?? "todo",
    input.priority ?? "none",
    normalizeId(input.assigneeId),
    normalizeId(input.projectId),
    input.dueDate ?? null,
    createdById,
    now,
    now,
  );

  for (const labelId of input.labelIds ?? []) {
    if (labelBelongsToTeam(teamId, labelId)) {
      db.prepare(
        "insert or ignore into task_labels (task_id, label_id) values (?, ?)",
      ).run(id, labelId);
    }
  }

  return getTask(teamId, id) as Task;
}

export function updateTask(
  teamId: string,
  taskId: string,
  input: UpdateTaskInput,
): Task | null {
  const current = db
    .prepare("select * from tasks where id = ? and team_id = ?")
    .get(taskId, teamId) as TaskRow | undefined;

  if (!current) {
    return null;
  }

  const next = {
    title: input.title ?? current.title,
    description: input.description ?? current.description,
    status: input.status ?? current.status,
    priority: input.priority ?? current.priority,
    assignee_id:
      input.assigneeId === undefined
        ? current.assignee_id
        : normalizeId(input.assigneeId),
    project_id:
      input.projectId === undefined
        ? current.project_id
        : normalizeId(input.projectId),
    due_date:
      input.dueDate === undefined ? current.due_date : input.dueDate ?? null,
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    `update tasks set
       title = ?, description = ?, status = ?, priority = ?,
       assignee_id = ?, project_id = ?, due_date = ?, updated_at = ?
     where id = ? and team_id = ?`,
  ).run(
    next.title,
    next.description,
    next.status,
    next.priority,
    next.assignee_id,
    next.project_id,
    next.due_date,
    next.updated_at,
    taskId,
    teamId,
  );

  return getTask(teamId, taskId);
}

export function deleteTask(teamId: string, taskId: string): boolean {
  const result = db
    .prepare("delete from tasks where id = ? and team_id = ?")
    .run(taskId, teamId);

  return result.changes > 0;
}

export function addTaskLabel(
  teamId: string,
  taskId: string,
  labelId: string,
): Task | null {
  if (!getTask(teamId, taskId) || !labelBelongsToTeam(teamId, labelId)) {
    return null;
  }

  db.prepare(
    "insert or ignore into task_labels (task_id, label_id) values (?, ?)",
  ).run(taskId, labelId);

  touchTask(taskId);
  return getTask(teamId, taskId);
}

export function removeTaskLabel(
  teamId: string,
  taskId: string,
  labelId: string,
): Task | null {
  if (!getTask(teamId, taskId)) {
    return null;
  }

  db.prepare(
    "delete from task_labels where task_id = ? and label_id = ?",
  ).run(taskId, labelId);

  touchTask(taskId);
  return getTask(teamId, taskId);
}

export function getInsights(teamId: string, currentUserId: string): Insights {
  const tasks = db
    .prepare("select * from tasks where team_id = ?")
    .all(teamId) as TaskRow[];

  const now = Date.now();
  const week = now + 7 * 86_400_000;

  const byStatus: Record<string, number> = {};
  let open = 0;
  let inProgress = 0;
  let inReview = 0;
  let completed = 0;
  let overdue = 0;
  let unassigned = 0;
  let assignedToMe = 0;
  let dueSoon = 0;

  for (const task of tasks) {
    const status = task.status as TaskStatus;
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const closed = isClosed(status);
    if (status === "in_progress") inProgress += 1;
    if (status === "in_review") inReview += 1;
    if (status === "done") completed += 1;
    if (!closed) {
      open += 1;
      if (!task.assignee_id) unassigned += 1;
      if (task.assignee_id === currentUserId) assignedToMe += 1;
      if (task.due_date) {
        const due = new Date(task.due_date).getTime();
        if (due < now) overdue += 1;
        else if (due <= week) dueSoon += 1;
      }
    }
  }

  return {
    total: tasks.length,
    open,
    inProgress,
    inReview,
    completed,
    overdue,
    unassigned,
    assignedToMe,
    dueSoon,
    byStatus: byStatus as Insights["byStatus"],
  };
}

/* ------------------------------- Helpers ------------------------------- */

function touchTask(taskId: string) {
  db.prepare("update tasks set updated_at = ? where id = ?").run(
    new Date().toISOString(),
    taskId,
  );
}

function labelBelongsToTeam(teamId: string, labelId: string): boolean {
  const row = db
    .prepare("select id from labels where id = ? and team_id = ?")
    .get(labelId, teamId);

  return Boolean(row);
}

function normalizeId(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return value;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isClosed(status: TaskStatus): boolean {
  return status === "done" || status === "canceled";
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db_ = new Date(b);
  return (
    da.getFullYear() === db_.getFullYear() &&
    da.getMonth() === db_.getMonth() &&
    da.getDate() === db_.getDate()
  );
}
