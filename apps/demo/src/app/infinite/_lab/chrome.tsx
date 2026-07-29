import Link from "next/link";
import { cn } from "@/lib/utils";
import { LAB_VARIANTS, type VariantId } from "./variants";

/**
 * Shared chrome: what the lab is, and the switcher between library variants.
 *
 * The switcher is driven by the metadata registry, so a variant that has not
 * been implemented yet still appears — greyed out — instead of being invisible.
 */
export function LabChrome({
  variant,
  summary,
}: {
  variant: VariantId;
  summary: string;
}) {
  return (
    <header className="space-y-3 px-6 pb-4 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          ← demo index
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <Link
          href="/infinite"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          infinite scroll lab
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Infinite scroll lab
          </h1>
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            An instrumented rig for watching what a data library actually does to
            a cursor-paginated list: when it refetches, in what order, and what
            the list looks like afterwards. Not a product feature — a
            measurement.
          </p>
        </div>

        <nav className="flex items-center gap-1 rounded-lg border bg-card p-1">
          {LAB_VARIANTS.map((entry) =>
            entry.available ? (
              <Link
                key={entry.id}
                href={entry.href}
                aria-current={entry.id === variant ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  entry.id === variant
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {entry.name}
              </Link>
            ) : (
              <span
                key={entry.id}
                aria-disabled
                title={entry.tagline}
                className="cursor-not-allowed rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground/60"
              >
                {entry.name}
                <span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[10px]">
                  {entry.badge}
                </span>
              </span>
            ),
          )}
        </nav>
      </div>

      <p className="rounded-lg border border-dashed bg-card/50 px-3 py-2 text-xs text-muted-foreground">
        {summary}
      </p>
    </header>
  );
}
