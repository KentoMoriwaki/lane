"use client";

import type {
  CreateLabelInput,
  CreateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "@/server/api";
import * as React from "react";
import { graphql, useMutation } from "react-relay";
import type {
  PayloadError,
  RecordSourceSelectorProxy,
} from "relay-runtime";
import type { mutationsUpdateTaskMutation } from "../__generated__/mutationsUpdateTaskMutation.graphql";
import type { mutationsDeleteTaskMutation } from "../__generated__/mutationsDeleteTaskMutation.graphql";
import type { mutationsAddTaskLabelMutation } from "../__generated__/mutationsAddTaskLabelMutation.graphql";
import type { mutationsRemoveTaskLabelMutation } from "../__generated__/mutationsRemoveTaskLabelMutation.graphql";
import type { mutationsCreateTaskMutation } from "../__generated__/mutationsCreateTaskMutation.graphql";
import type { mutationsCreateLabelMutation } from "../__generated__/mutationsCreateLabelMutation.graphql";
import type { mutationsCreateProjectMutation } from "../__generated__/mutationsCreateProjectMutation.graphql";

/**
 * Mutations for the Relay variant.
 *
 * Every task mutation returns the updated `Task` selecting the SAME fragments
 * the list row and detail panel read — so the normalized store reconciles every
 * view of that task from one response, with no cache-sync code (contrast the
 * other variants' `task-cache-sync.ts`). Scalar edits and deletes also write an
 * `optimisticUpdater` against the store, so the change shows everywhere
 * instantly and Relay rolls it back automatically if the server rejects it.
 */

/* ------------------------------ Documents ------------------------------ */

const updateTaskMutation = graphql`
  mutation mutationsUpdateTaskMutation($id: ID!, $input: UpdateTaskInput!) {
    updateTask(id: $id, input: $input) {
      id
      ...taskRow_task
      ...taskDetailPanel_task
    }
  }
`;

const deleteTaskMutation = graphql`
  mutation mutationsDeleteTaskMutation($id: ID!) {
    deleteTask(id: $id) {
      deletedTaskId
    }
  }
`;

const addTaskLabelMutation = graphql`
  mutation mutationsAddTaskLabelMutation($taskId: ID!, $labelId: ID!) {
    addTaskLabel(taskId: $taskId, labelId: $labelId) {
      id
      ...taskRow_task
      ...taskDetailPanel_task
    }
  }
`;

const removeTaskLabelMutation = graphql`
  mutation mutationsRemoveTaskLabelMutation($taskId: ID!, $labelId: ID!) {
    removeTaskLabel(taskId: $taskId, labelId: $labelId) {
      id
      ...taskRow_task
      ...taskDetailPanel_task
    }
  }
`;

const createTaskMutation = graphql`
  mutation mutationsCreateTaskMutation($input: CreateTaskInput!) {
    createTask(input: $input) {
      id
      ...taskRow_task
      ...taskDetailPanel_task
    }
  }
`;

const createLabelMutation = graphql`
  mutation mutationsCreateLabelMutation($input: CreateLabelInput!) {
    createLabel(input: $input) {
      id
      name
      color
    }
  }
`;

const createProjectMutation = graphql`
  mutation mutationsCreateProjectMutation($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      key
      color
      taskCount
    }
  }
`;

/* ------------------------------- Helpers ------------------------------- */

function rejectionFromErrors(
  errors: readonly PayloadError[] | null | undefined,
): Error | null {
  if (!errors || errors.length === 0) {
    return null;
  }
  return new Error(errors[0]?.message ?? "Request failed");
}

/** Apply scalar edits to the task record so the change is visible immediately. */
function applyScalarPatch(
  store: RecordSourceSelectorProxy,
  taskId: string,
  input: UpdateTaskInput,
) {
  const task = store.get(taskId);
  if (!task) return;

  if (input.title !== undefined) task.setValue(input.title, "title");
  if (input.description !== undefined) {
    task.setValue(input.description, "description");
  }
  if (input.status !== undefined) task.setValue(input.status, "status");
  if (input.priority !== undefined) task.setValue(input.priority, "priority");
  if (input.dueDate !== undefined) {
    task.setValue(input.dueDate ?? null, "dueDate");
  }
}

/* ------------------------------ Mutations ------------------------------ */

export function useUpdateTask(taskId: string) {
  const [commit] = useMutation<mutationsUpdateTaskMutation>(updateTaskMutation);

  return React.useCallback(
    (input: UpdateTaskInput) =>
      new Promise<void>((resolve, reject) => {
        commit({
          variables: { id: taskId, input },
          // Scalar edits show instantly across every view; Relay reverts them
          // automatically if the mutation rejects.
          optimisticUpdater: (store) => applyScalarPatch(store, taskId, input),
          onCompleted: (_response, errors) => {
            const error = rejectionFromErrors(errors);
            if (error) reject(error);
            else resolve();
          },
          onError: reject,
        });
      }),
    [commit, taskId],
  );
}

export function useDeleteTask() {
  const [commit] = useMutation<mutationsDeleteTaskMutation>(deleteTaskMutation);

  return React.useCallback(
    (taskId: string) =>
      new Promise<void>((resolve, reject) => {
        commit({
          variables: { id: taskId },
          // Deleting the record drops it from every list that referenced it.
          optimisticUpdater: (store) => store.delete(taskId),
          updater: (store) => store.delete(taskId),
          onCompleted: (_response, errors) => {
            const error = rejectionFromErrors(errors);
            if (error) reject(error);
            else resolve();
          },
          onError: reject,
        });
      }),
    [commit],
  );
}

export function useAddTaskLabel(taskId: string) {
  const [commit] =
    useMutation<mutationsAddTaskLabelMutation>(addTaskLabelMutation);

  return React.useCallback(
    (labelId: string) =>
      new Promise<void>((resolve, reject) => {
        commit({
          variables: { taskId, labelId },
          onCompleted: (_response, errors) => {
            const error = rejectionFromErrors(errors);
            if (error) reject(error);
            else resolve();
          },
          onError: reject,
        });
      }),
    [commit, taskId],
  );
}

export function useRemoveTaskLabel(taskId: string) {
  const [commit] = useMutation<mutationsRemoveTaskLabelMutation>(
    removeTaskLabelMutation,
  );

  return React.useCallback(
    (labelId: string) =>
      new Promise<void>((resolve, reject) => {
        commit({
          variables: { taskId, labelId },
          onCompleted: (_response, errors) => {
            const error = rejectionFromErrors(errors);
            if (error) reject(error);
            else resolve();
          },
          onError: reject,
        });
      }),
    [commit, taskId],
  );
}

export function useCreateTask() {
  const [commit] = useMutation<mutationsCreateTaskMutation>(createTaskMutation);

  return React.useCallback(
    (input: CreateTaskInput) =>
      new Promise<string>((resolve, reject) => {
        commit({
          variables: { input },
          onCompleted: (response, errors) => {
            const error = rejectionFromErrors(errors);
            if (error) reject(error);
            else resolve(response.createTask.id);
          },
          onError: reject,
        });
      }),
    [commit],
  );
}

export function useCreateLabel() {
  const [commit] =
    useMutation<mutationsCreateLabelMutation>(createLabelMutation);

  return React.useCallback(
    (input: CreateLabelInput) =>
      new Promise<{ id: string; name: string; color: string }>(
        (resolve, reject) => {
          commit({
            variables: { input },
            onCompleted: (response, errors) => {
              const error = rejectionFromErrors(errors);
              if (error) reject(error);
              else resolve(response.createLabel);
            },
            onError: reject,
          });
        },
      ),
    [commit],
  );
}

export function useCreateProject() {
  const [commit] =
    useMutation<mutationsCreateProjectMutation>(createProjectMutation);

  return React.useCallback(
    (input: CreateProjectInput) =>
      new Promise<{ id: string; name: string; color: string }>(
        (resolve, reject) => {
          commit({
            variables: { input },
            onCompleted: (response, errors) => {
              const error = rejectionFromErrors(errors);
              if (error) reject(error);
              else resolve(response.createProject);
            },
            onError: reject,
          });
        },
      ),
    [commit],
  );
}
