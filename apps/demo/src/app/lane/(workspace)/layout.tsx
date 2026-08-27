import { Suspense, type ReactNode } from "react";
import { WorkspaceBrand } from "@/app/lane/workspace/brand";
import { Sidebar } from "@/app/lane/workspace/sidebar";
import { SidebarSkeleton } from "@/app/lane/workspace/skeletons";
import { Workspace } from "@/app/lane/workspace/workspace";

/**
 * The list workspace's persistent shell.
 *
 * Route groups do not affect the URL, but their layout survives navigation
 * among `/lane`, named Contexts, and project pages. The Sidebar is therefore
 * one mounted reader of the root layout's Lane rather than a new reader owned
 * by every page. Each page still publishes the active team's sidebar keys; a
 * navigation hydrates those keys before it commits, and this mounted reader
 * adopts them without returning to its first-load fallback.
 *
 * The standalone task page deliberately sits outside this group. Its
 * intercepted form remains in the root `@modal` slot beside this shell.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Workspace
      sidebar={
        <Suspense fallback={<SidebarSkeleton brand={<WorkspaceBrand />} />}>
          <Sidebar />
        </Suspense>
      }
    >
      {children}
    </Workspace>
  );
}
