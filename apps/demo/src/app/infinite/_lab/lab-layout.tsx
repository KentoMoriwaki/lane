import type { ReactNode } from "react";

/**
 * The page frame every variant is measured in: controls and list on the left,
 * observability pinned on the right.
 *
 * Slots only — no state, no data, no opinion about what goes in them. Keeping
 * the frame identical is what makes two variants visually comparable; what each
 * variant puts inside `main` is entirely up to it, including suspending or
 * throwing to an Error Boundary instead of rendering a list at all.
 */
export function LabLayout({
  chrome,
  controls,
  main,
  sidebar,
}: {
  chrome: ReactNode;
  controls: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {chrome}

      <div className="grid items-start gap-4 px-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">{controls}</div>
          {main}
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          {sidebar}
        </aside>
      </div>
    </main>
  );
}
