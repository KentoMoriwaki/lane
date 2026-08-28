"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useWorkspaceUrl } from "./use-workspace-url";

let pendingDirectTaskId: string | null = null;

/**
 * Turn a hard task visit into the same intercepted tree a row click creates.
 *
 * `/lane/tasks/:id` records a one-shot task ID and replaces itself with All
 * tasks. Once that list is mounted, replacing it with the canonical task URL
 * is a soft navigation, so the workspace interceptor can keep the list mounted
 * without manufacturing a list entry in browser history.
 */
export function TaskRouteBootstrap() {
  const router = useRouter();
  const { rememberTaskNavigation, taskHref } = useWorkspaceUrl();
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;

    const taskId = pendingDirectTaskId?.trim() ?? "";
    if (!taskId) return;

    startedRef.current = true;
    pendingDirectTaskId = null;
    const href = taskHref(taskId);
    rememberTaskNavigation(href, { closeMode: "push" });
    router.replace(href, { scroll: false });
  }, [rememberTaskNavigation, router, taskHref]);

  return null;
}

/** Move a hard task visit onto the clean list entry that will own its panel. */
export function DirectTaskRouteBootstrap({
  taskId,
  listHref,
}: {
  taskId: string;
  listHref: string;
}) {
  const router = useRouter();
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    pendingDirectTaskId = taskId;
    router.replace(listHref, { scroll: false });
  }, [listHref, router, taskId]);

  return null;
}
