import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  CurrentUser,
  Project,
  Task,
  TeamLabel,
  UpdateTaskInput,
} from "@/server/api";
import { atom, type Setter } from "jotai";
import { atomFamily } from "jotai-family";
import type { WorkspaceCtx } from "./client";
import {
  addTaskLabel,
  createLabel,
  createProject,
  createTask,
  deleteTask,
  EMPTY_FILTERS,
  fetchCurrentUser,
  fetchInsights,
  fetchLabels,
  fetchMembers,
  fetchProjects,
  fetchTask,
  fetchTasks,
  fetchTasksByIds,
  fetchTeams,
  removeTaskLabel,
  type TaskFilters,
  updateTask,
} from "./endpoints";
import { queryAtom } from "./query-atom";
import {
  replaceTaskInList,
  type TaskCacheStrategy,
  taskCacheStrategies,
  taskFiltersKey,
} from "./task-cache-sync";

/* --------------------------- Session identity --------------------------- */

/**
 * Who we are and which team we are looking at. In the other variants this
 * lives in React state (or the URL) beside a separate cache; here it is an
 * atom the reads depend on, which is what makes team switching a pure data
 * change instead of a cache-eviction call.
 */
export const userIdAtom = atom("");
export const activeTeamIdAtom = atom("");
export const isSignedInAtom = atom(true);

/** Bumped on sign-in so nothing from the previous session is reused. */
const sessionEpochAtom = atom(0);

export const workspaceCtxAtom = atom<WorkspaceCtx>((get) => ({
  userId: get(userIdAtom),
  teamId: get(activeTeamIdAtom),
}));

/** Scope for reads that follow the user across teams (session, team list). */
const sessionScopeAtom = atom(
  (get) => `${get(sessionEpochAtom)}/${get(userIdAtom)}`,
);

/** Scope for everything the active team owns. */
const teamScopeAtom = atom(
  (get) => `${get(sessionScopeAtom)}/${get(activeTeamIdAtom)}`,
);

/**
 * The very first read, made before a session exists: with no `x-user-id` /
 * `x-team-id` headers the API answers with its seeded default user. Its result
 * seeds a store (see `workspace-app.tsx`), so this atom is never read again.
 */
export const bootstrapUserAtom = atom(() =>
  fetchCurrentUser({ userId: "", teamId: "" }),
);

/* ------------------------------ View state ------------------------------ */

export const filtersAtom = atom<TaskFilters>(EMPTY_FILTERS);
export const selectedTaskIdAtom = atom<string | null>(null);

export const patchFiltersAtom = atom(
  null,
  (get, set, patch: Partial<TaskFilters>) => {
    set(filtersAtom, { ...get(filtersAtom), ...patch });
  },
);

export const resetFiltersAtom = atom(null, (_get, set) => {
  set(filtersAtom, EMPTY_FILTERS);
});

/* --------------------------------- Reads -------------------------------- */

export const currentUserAtom = queryAtom<CurrentUser>(
  sessionScopeAtom,
  (get) => fetchCurrentUser(get(workspaceCtxAtom)),
);

export const teamsAtom = queryAtom(sessionScopeAtom, (get) =>
  fetchTeams(get(workspaceCtxAtom)),
);

export const projectsAtom = queryAtom(teamScopeAtom, (get) =>
  fetchProjects(get(workspaceCtxAtom)),
);

export const labelsAtom = queryAtom(teamScopeAtom, (get) =>
  fetchLabels(get(workspaceCtxAtom)),
);

export const membersAtom = queryAtom(teamScopeAtom, (get) =>
  fetchMembers(get(workspaceCtxAtom)),
);

export const insightsAtom = queryAtom(teamScopeAtom, (get) =>
  fetchInsights(get(workspaceCtxAtom)),
);

/**
 * One atom per distinct filter set — the family is what turns "an atom holding
 * a promise" into a keyed cache, so going back to a previous filter shows its
 * result immediately. Eviction is `remove`, plus `setShouldRemove` for an age
 * cutoff that the family applies when a param is next looked up rather than on
 * a timer. This demo sets neither: every cached list stays addressable, which
 * is what lets a write reconcile all of them (see `publishTask`).
 */
export const tasksAtomFamily = atomFamily(
  (filters: TaskFilters) =>
    queryAtom(teamScopeAtom, (get) =>
      fetchTasks(get(workspaceCtxAtom), filters),
    ),
  (left, right) => taskFiltersKey(left) === taskFiltersKey(right),
);

/**
 * A task id only means something inside one team, so per-task reads carry the
 * team in their key instead of reading it back out of the store. Both would
 * keep the data correct — but a `get` is also an invalidation edge, and a
 * team-scoped detail read is recomputed the moment the team changes, which
 * would send the open task's id to the team that has never heard of it. Keyed,
 * the old entry is simply unaddressable.
 */
export type TaskKey = {
  teamId: string;
  taskId: string;
};

const sameTaskKey = (left: TaskKey, right: TaskKey) =>
  left.teamId === right.teamId && left.taskId === right.taskId;

export const taskAtomFamily = atomFamily(
  ({ teamId, taskId }: TaskKey) =>
    queryAtom(sessionScopeAtom, (get) =>
      fetchTask({ userId: get(userIdAtom), teamId }, taskId),
    ),
  sameTaskKey,
);

/**
 * The two reads behind the detail panel's dependency status. Neither takes the
 * edge ids: each derives them from the task's own atom, so the read gates
 * itself (no edges, no request), re-runs whenever that task is republished, and
 * never has to thread ids through a key.
 */
export const blockedByAtomFamily = atomFamily(
  (key: TaskKey) =>
    queryAtom(sessionScopeAtom, async (get) => {
      const ctx = { userId: get(userIdAtom), teamId: key.teamId };
      const task = await get(taskAtomFamily(key));
      return fetchTasksByIds(ctx, task.blockedBy);
    }),
  sameTaskKey,
);

export const blockingAtomFamily = atomFamily(
  (key: TaskKey) =>
    queryAtom(sessionScopeAtom, async (get) => {
      const ctx = { userId: get(userIdAtom), teamId: key.teamId };
      const task = await get(taskAtomFamily(key));
      return fetchTasksByIds(ctx, task.blocks);
    }),
  sameTaskKey,
);

/**
 * The list the workspace is looking at, and the task it has open. Both are
 * derived from the view atoms rather than passed down as props, which is what
 * keeps a view change and the read it addresses inside one atom write: clearing
 * the selection stops this depending on that task's atom in the same update,
 * instead of one render later.
 */
export const currentTasksAtom = atom((get) =>
  get(tasksAtomFamily(get(filtersAtom))),
);

export const selectedTaskAtom = atom((get) => {
  const taskId = get(selectedTaskIdAtom);
  return taskId === null
    ? null
    : get(taskAtomFamily({ teamId: get(activeTeamIdAtom), taskId }));
});

/* ------------------------------- Mutations ------------------------------ */

/**
 * How a mutation hands its store writes back to its caller.
 *
 * React's transition does not survive an `await`. Everything a mutation writes
 * *after* its request resolves would otherwise land as a default-priority
 * update, so any read it invalidates re-suspends into its fallback instead of
 * holding what is on screen — a skeleton in place of a list the user is looking
 * at. Mutations therefore never commit their own writes: they collect them into
 * one function and pass it to the `commit` they were called with, and
 * `hooks.ts` supplies a transition. Keeping it a parameter is also what keeps
 * this module free of React.
 */
export type Commit = (publish: () => void) => void;

export const createTaskAtom = atom(
  null,
  async (
    get,
    set,
    commit: Commit,
    input: CreateTaskInput,
  ): Promise<Task> => {
    // The context is read once, up front. Everything a write publishes lands in
    // the team it was issued against, even if the user switches teams while the
    // request is in flight.
    const ctx = get(workspaceCtxAtom);
    const task = await createTask(ctx, input);

    commit(() => {
      set(taskAtomFamily({ teamId: ctx.teamId, taskId: task.id }), {
        type: "set",
        value: task,
      });
      // A new task can belong in any list, so none of them can be patched.
      refreshTaskLists(set);
      set(insightsAtom, { type: "refresh" });
      if (task.project) {
        set(projectsAtom, { type: "refresh" });
      }
    });

    return task;
  },
);

export const updateTaskAtom = atom(
  null,
  async (
    get,
    set,
    commit: Commit,
    taskId: string,
    input: UpdateTaskInput,
    strategy: TaskCacheStrategy,
  ): Promise<Task> => {
    const ctx = get(workspaceCtxAtom);
    const task = await updateTask(ctx, taskId, input);
    commit(() => publishTask(set, ctx.teamId, task, strategy));
    return task;
  },
);

export const deleteTaskAtom = atom(
  null,
  async (get, set, commit: Commit, taskId: string): Promise<void> => {
    const ctx = get(workspaceCtxAtom);
    await deleteTask(ctx, taskId);

    commit(() => {
      // Dropping the atoms from their families is this variant's `remove`: the
      // detail read for a deleted task must never be refetched.
      const key = { teamId: ctx.teamId, taskId };
      taskAtomFamily.remove(key);
      blockedByAtomFamily.remove(key);
      blockingAtomFamily.remove(key);

      for (const filters of [...tasksAtomFamily.getParams()]) {
        set(tasksAtomFamily(filters), {
          type: "update",
          updater: (tasks) => tasks.filter((item) => item.id !== taskId),
        });
      }

      set(insightsAtom, { type: "refresh" });
      set(projectsAtom, { type: "refresh" });
      refreshDependencyReads(set);
    });
  },
);

export const addTaskLabelAtom = atom(
  null,
  async (
    get,
    set,
    commit: Commit,
    taskId: string,
    label: TeamLabel,
  ): Promise<Task> => {
    const ctx = get(workspaceCtxAtom);
    const task = await addTaskLabel(ctx, taskId, label.id);
    commit(() =>
      publishTask(set, ctx.teamId, task, taskCacheStrategies.labels),
    );
    return task;
  },
);

export const removeTaskLabelAtom = atom(
  null,
  async (
    get,
    set,
    commit: Commit,
    taskId: string,
    labelId: string,
  ): Promise<Task> => {
    const ctx = get(workspaceCtxAtom);
    const task = await removeTaskLabel(ctx, taskId, labelId);
    commit(() =>
      publishTask(set, ctx.teamId, task, taskCacheStrategies.labels),
    );
    return task;
  },
);

export const createLabelAtom = atom(
  null,
  async (
    get,
    set,
    commit: Commit,
    input: CreateLabelInput,
  ): Promise<TeamLabel> => {
    const label = await createLabel(get(workspaceCtxAtom), input);
    commit(() => set(labelsAtom, { type: "refresh" }));
    return label;
  },
);

export const createProjectAtom = atom(
  null,
  async (
    get,
    set,
    commit: Commit,
    input: CreateProjectInput,
  ): Promise<Project> => {
    const project = await createProject(get(workspaceCtxAtom), input);
    commit(() => set(projectsAtom, { type: "refresh" }));
    return project;
  },
);

/* ------------------------- Session and refresh -------------------------- */

export const switchTeamAtom = atom(null, (get, set, teamId: string) => {
  if (teamId === get(activeTeamIdAtom)) {
    return;
  }

  // A filter or a task id from the old team means nothing in the new one.
  set(filtersAtom, EMPTY_FILTERS);
  set(selectedTaskIdAtom, null);

  // The switch itself — one write, nothing to evict. The team is part of the
  // scope every team-scoped read depends on, so this *is* the invalidation:
  // whatever is on screen re-reads, and inside a transition it keeps the
  // current team's workspace until the next one is ready.
  set(activeTeamIdAtom, teamId);

  // Then everything the old team cached goes. Per-task entries can only ever be
  // addressed by the team that made them, and a cached list would be re-read on
  // its next use anyway now that the scope has moved. What survives is the one
  // list the reset view is about to read, so the switch costs a fetch of it and
  // nothing else.
  for (const family of [
    taskAtomFamily,
    blockedByAtomFamily,
    blockingAtomFamily,
  ]) {
    for (const key of [...family.getParams()]) {
      if (key.teamId !== teamId) {
        family.remove(key);
      }
    }
  }

  for (const filters of [...tasksAtomFamily.getParams()]) {
    if (taskFiltersKey(filters) !== taskFiltersKey(EMPTY_FILTERS)) {
      tasksAtomFamily.remove(filters);
    }
  }
});

export const signOutAtom = atom(null, (_get, set) => {
  set(isSignedInAtom, false);
});

export const signInAtom = atom(null, (_get, set) => {
  // Bumping the epoch moves every scope, so the signed-out session's data is
  // unreachable and the workspace comes back with fresh reads.
  set(sessionEpochAtom, (epoch) => epoch + 1);
  set(filtersAtom, EMPTY_FILTERS);
  set(selectedTaskIdAtom, null);
  set(isSignedInAtom, true);
});

export const refreshWorkspaceAtom = atom(null, (_get, set) => {
  refreshTaskLists(set);
  set(insightsAtom, { type: "refresh" });
  set(projectsAtom, { type: "refresh" });
  set(labelsAtom, { type: "refresh" });
  set(membersAtom, { type: "refresh" });
});

/* -------------------------------- Helpers ------------------------------- */

/**
 * Reconcile every cached task list with a task the server just returned.
 * `getParams()` is what makes this possible without a key-pattern API: the
 * family hands back the filters each live list was built from, so the strategy
 * can be applied per list — patch the ones whose membership is unaffected,
 * refetch the ones the edit could have added rows to or dropped rows from.
 */
function publishTask(
  set: Setter,
  teamId: string,
  task: Task,
  strategy: TaskCacheStrategy,
) {
  set(taskAtomFamily({ teamId, taskId: task.id }), {
    type: "set",
    value: task,
  });

  for (const filters of [...tasksAtomFamily.getParams()]) {
    set(
      tasksAtomFamily(filters),
      strategy.shouldInvalidateTaskList(filters)
        ? { type: "refresh" }
        : { type: "update", updater: (tasks) => replaceTaskInList(tasks, task) },
    );
  }

  if (strategy.refreshInsights) {
    set(insightsAtom, { type: "refresh" });
  }

  if (strategy.refreshProjects) {
    set(projectsAtom, { type: "refresh" });
  }

  refreshDependencyReads(set);
}

function refreshTaskLists(set: Setter) {
  for (const filters of [...tasksAtomFamily.getParams()]) {
    set(tasksAtomFamily(filters), { type: "refresh" });
  }
}

/**
 * A dependency read caches a copy of the edge's task, status included. Its own
 * task changing already re-runs it (it derives from that atom), but a status
 * change on the *other* end of the edge does not, so every write refreshes
 * them to keep the verdict honest.
 */
function refreshDependencyReads(set: Setter) {
  for (const family of [blockedByAtomFamily, blockingAtomFamily]) {
    for (const key of [...family.getParams()]) {
      set(family(key), { type: "refresh" });
    }
  }
}
