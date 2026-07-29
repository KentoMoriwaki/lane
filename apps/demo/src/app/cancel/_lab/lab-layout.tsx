import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The page frame: field and results on the left, observability pinned right.
 *
 * Slots only — no state, no data. A local copy rather than a shared one with the
 * infinite lab on purpose: the two labs measure different things and are free to
 * drift, the same way their server apps are separate from the team API.
 */
export function LabLayout({
  controls,
  main,
  sidebar,
  summary,
}: {
  controls: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
  summary: string;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="space-y-3 px-6 pb-4 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            ← demo index
          </Link>
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Cancel lab</h1>
          <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
            An instrumented rig for watching what happens to a read that is still
            in flight when the key moves on: whether the request stops, what the
            key holds afterwards, and who has to ask. Not a product feature — a
            measurement.
          </p>
        </div>

        <p className="rounded-lg border border-dashed bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          {summary}
        </p>
      </header>

      <div className="grid items-start gap-4 px-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
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
