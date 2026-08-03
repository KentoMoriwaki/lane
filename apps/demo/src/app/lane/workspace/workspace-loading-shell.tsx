import { Skeleton } from "@/components/ui/skeleton";

/**
 * Static App Shell for the server-owned workspace.
 *
 * It deliberately contains no request or URL data. Cache Components can reuse
 * it for every `/lane` link while the authoritative Lane publication streams
 * behind the page's Suspense boundary.
 */
export function WorkspaceLoadingShell() {
  return (
    <div
      data-testid="lane-workspace-shell"
      aria-label="Loading workspace"
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="flex size-6 items-center justify-center rounded-md bg-sage text-sm font-bold text-primary-foreground">
            L
          </span>
          <span className="text-sm font-semibold tracking-tight">Lane</span>
        </div>
        <div className="space-y-5 px-3 py-3">
          <Skeleton className="h-9 w-full" />
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <div className="h-9 w-full max-w-md rounded-md border border-input bg-background/60" />
          <Skeleton className="ml-auto h-9 w-9 shrink-0" />
          <Skeleton className="h-9 w-24 shrink-0" />
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="grid grid-cols-2 gap-3 border-b border-border px-4 py-3 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
            <div className="flex h-[49px] items-center gap-2 border-b border-border px-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-7 w-20" />
              ))}
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 7 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <Skeleton className="size-5 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          </section>

          <aside className="hidden w-[360px] shrink-0 border-l border-border bg-surface p-4 lg:block">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="mt-4 h-24 w-full" />
            <Skeleton className="mt-6 h-9 w-full" />
          </aside>
        </div>
      </div>
    </div>
  );
}
