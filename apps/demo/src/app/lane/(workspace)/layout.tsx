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
 * by every page. Each Context page owns its visible list and loading boundary;
 * only the Sidebar, Topbar, and create state persist here.
 */
export default function WorkspaceLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <Workspace
      sidebar={
        <Suspense fallback={<SidebarSkeleton brand={<WorkspaceBrand />} />}>
          <Sidebar />
        </Suspense>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        {children}
        {modal}
      </div>
    </Workspace>
  );
}
