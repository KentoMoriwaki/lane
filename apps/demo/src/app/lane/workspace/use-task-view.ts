"use client";

import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";
import { contextFromPathname } from "./workspace-context";
import { useWorkspaceUrl } from "./use-workspace-url";

export type TaskGroupBy =
  | "priority"
  | "status"
  | "project"
  | "assignee"
  | "none";
export type TaskSortBy =
  | "default"
  | "due"
  | "priority"
  | "updated"
  | "created"
  | "title";
export type TaskSortOrder = "asc" | "desc";

const GROUP_VALUES: TaskGroupBy[] = [
  "priority",
  "status",
  "project",
  "assignee",
  "none",
];
const SORT_VALUES: TaskSortBy[] = [
  "default",
  "due",
  "priority",
  "updated",
  "created",
  "title",
];

export function useTaskView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const { contextPathname } = useWorkspaceUrl();
  const isListRoute = Boolean(contextFromPathname(pathname));
  const listSearchRef = React.useRef(searchString);
  if (isListRoute) listSearchRef.current = searchString;
  const viewSearchString = isListRoute ? searchString : listSearchRef.current;
  const viewParams = new URLSearchParams(viewSearchString);
  const group = valueOf(GROUP_VALUES, viewParams.get("group")) ?? "priority";
  const sort = valueOf(SORT_VALUES, viewParams.get("sort")) ?? "default";
  const order: TaskSortOrder =
    viewParams.get("order") === "desc" ? "desc" : "asc";

  // Grouping and sorting are browser-owned presentation. Native history keeps
  // the URL shareable and synchronized with Next's navigation hooks without
  // asking the server to republish an unchanged task set.
  const updateView = React.useCallback(
    (patch: {
      group?: TaskGroupBy;
      sort?: TaskSortBy;
      order?: TaskSortOrder;
    }) => {
      const params = new URLSearchParams(viewSearchString);
      const next = { group, sort, order, ...patch };

      setOrDelete(params, "group", next.group, "priority");
      setOrDelete(params, "sort", next.sort, "default");
      setOrDelete(params, "order", next.order, "asc");

      const search = params.toString();
      window.history.pushState(
        null,
        "",
        `${contextPathname}${search ? `?${search}` : ""}`,
      );
    },
    [contextPathname, group, order, sort, viewSearchString],
  );

  return { group, sort, order, updateView };
}

function valueOf<T extends string>(
  values: readonly T[],
  value: string | null,
): T | null {
  return value && (values as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
) {
  if (value === defaultValue) params.delete(key);
  else params.set(key, value);
}
