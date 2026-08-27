import type { ReactNode } from "react";
import { getSession } from "@/app/lane/api/session";
import { WorkspaceProvider } from "@/app/lane/workspace/workspace-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The route group's shell: one lane, and the row the detail is drawn into.
 *
 * **One lane for the workspace routes.** `WorkspaceProvider` used to sit in `page.tsx`,
 * where it was created and destroyed with the list. It has to live here now,
 * because named Contexts, projects, and `/lane/task/[id]` all publish into the
 * same keys. A layout is not remounted when the page below it changes, so the
 * lane survives navigation between them. That is the mechanism behind "edit
 * on the task page, come back, the list reloads".
 *
 * **The panel is a slot.** `modal` is `@modal`, and what it holds is the
 * *intercepted* form of `/lane/task/[id]` (`@modal/(.)task/[id]`): a `<Link>`
 * from a row lands the detail in that slot while the list stays exactly where
 * it is, and this layout draws it as the column beside the list. A direct visit
 * or a reload of the same URL is not intercepted — `children` becomes the task
 * page and `@modal/[...catchAll]` renders nothing.
 *
 * This layout awaits nothing. `getSession()` is handed on unresolved (see
 * `WorkspaceProvider`), so the nested workspace and task shells stay static.
 */
export default function LaneLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <WorkspaceProvider session={getSession()}>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          {children}
          {modal}
        </div>
      </WorkspaceProvider>
      <Toaster />
    </TooltipProvider>
  );
}
