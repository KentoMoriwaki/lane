"use client";

import * as React from "react";
import {
  contextForKey,
  projectPath,
  type WorkspaceContextKey,
} from "./workspace-context";
import { useWorkspaceUrl } from "./use-workspace-url";

/** Named task Context links preserve search and presentation, not predicates. */
export function useWorkspaceHrefs() {
  const { contextHref, contextKey, fixedProjectId } = useWorkspaceUrl();

  const workspaceHref = React.useCallback(
    (key: Exclude<WorkspaceContextKey, "project">) =>
      contextHref(contextForKey(key)),
    [contextHref],
  );

  const projectHref = React.useCallback(
    (projectId: string) =>
      contextHref({
        key: "project",
        pathname: projectPath(projectId),
        projectId,
      }),
    [contextHref],
  );

  return {
    contextKey,
    projectId: fixedProjectId,
    projectHref,
    workspaceHref,
  };
}
