import type { ReactNode } from "react";
import { getSession } from "@/app/lane/api/session";
import { WorkspaceProvider } from "@/app/lane/workspace/workspace-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The route group's shell: one lane for every list Context and task panel.
 *
 * **One lane for the workspace routes.** `WorkspaceProvider` used to sit in `page.tsx`,
 * where it was created and destroyed with the list. It has to live here now,
 * because every generated Context and intercepted `/lane/tasks/[taskId]`
 * publication uses the same keys. A layout is not remounted while the task is
 * intercepted, so the
 * lane survives navigation between them. Layout readers can therefore keep
 * their DOM and consume snapshots published by whichever page is active.
 *
 * The `(workspace)` layout owns one panel slot for Context and project lists.
 * Keeping it below this root lets a list remain active when a canonical task
 * URL is intercepted; the root only owns the store shared by both columns.
 *
 * This layout awaits nothing. `getSession()` is handed on unresolved (see
 * `WorkspaceProvider`), so the nested workspace and task shells stay static.
 */
export default function LaneLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <WorkspaceProvider session={getSession()}>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          {children}
        </div>
      </WorkspaceProvider>
      <Toaster />
    </TooltipProvider>
  );
}
