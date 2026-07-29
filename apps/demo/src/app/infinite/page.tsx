import Link from "next/link";
import { LAB_VARIANTS } from "./_lab/variants";

/**
 * Index for the infinite-scroll lab.
 *
 * The lab is deliberately standalone: it does not share a single line with the
 * five team-task workspace variants, and it runs against its own generated feed
 * (`/api/feed`) rather than the 20-row seeded task table. It exists to answer
 * one question before `use-lane` grows an infinite-list API — what does the
 * incumbent actually do when you invalidate a list that is five pages deep?
 */
export default function InfiniteLabIndex() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-4">
        <Link
          href="/"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          ← demo index
        </Link>
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          use-lane · laboratory
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">
          Infinite scroll lab
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">
          An instrumented cursor-paginated feed with knobs for latency, page
          size, sort, cursor semantics and injected failures — plus a request log
          that draws every HTTP call on a shared time axis, so you can see
          whether a refetch of five loaded pages goes out together or one after
          the other.
        </p>
        <p className="text-pretty text-muted-foreground">
          It is a measurement rig, not a feature. Fetches are instrumented at the{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">fetch</code>{" "}
          layer, so every variant is timed by the same stopwatch.
        </p>
      </header>

      <ul className="space-y-3">
        {LAB_VARIANTS.map((variant) => {
          const body = (
            <div
              className={`flex items-center justify-between gap-4 rounded-xl border px-5 py-4 transition-colors ${
                variant.available
                  ? "bg-card group-hover:border-foreground/30"
                  : "border-dashed bg-card/40"
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{variant.name}</span>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {variant.badge}
                  </span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {variant.href}
                  </code>
                </div>
                <p className="text-sm text-muted-foreground">
                  {variant.tagline}
                </p>
              </div>
              {variant.available ? (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              ) : null}
            </div>
          );

          return (
            <li key={variant.id}>
              {variant.available ? (
                <Link href={variant.href} className="group block">
                  {body}
                </Link>
              ) : (
                <div className="cursor-not-allowed opacity-70">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
