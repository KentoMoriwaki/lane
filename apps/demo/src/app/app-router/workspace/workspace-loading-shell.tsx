import { WorkspaceSkeleton } from "@/app/lane/workspace/skeletons";
import { WorkspaceBrand } from "./brand";

/** Static, URL-independent App Shell for the props-only baseline. */
export function WorkspaceLoadingShell() {
  return (
    <WorkspaceSkeleton
      brand={<WorkspaceBrand />}
      testId="app-router-workspace-shell"
      label="Loading App Router workspace"
    />
  );
}
