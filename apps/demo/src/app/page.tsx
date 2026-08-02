import Link from "next/link";

type Variant = {
  href: string;
  name: string;
  badge: string;
  tagline: string;
};

const VARIANTS: Variant[] = [
  {
    href: "/lane",
    name: "use-lane",
    badge: "server-owned",
    tagline:
      "The RSC route is the only supplier: it seeds every key, reads are `external` (they wait for the publication instead of fetching), and mutations are server actions that revalidate — so one payload updates the task, the lists, and the insights together. useOptimistic covers the round trip.",
  },
  {
    href: "/lane-spa",
    name: "use-lane",
    badge: "client-owned",
    tagline:
      "The same workspace with the opposite answer: no seeding, the client fetches and owns every key from first paint, and keeps its own cache honest after a mutation — publish the task, patch the lists, invalidate what derives from it.",
  },
  {
    href: "/react-query",
    name: "TanStack Query",
    badge: "baseline",
    tagline:
      "The baseline: a resolved-value cache with its own query/mutation hooks, status objects, and optimistic patches.",
  },
  {
    href: "/relay",
    name: "Relay",
    badge: "GraphQL",
    tagline:
      "The transition/Suspense yardstick: a normalized GraphQL store, fragment colocation, preloaded queries refetched in transitions, and @defer streaming. Client-owned, like the SPA variant.",
  },
  {
    href: "/jotai",
    name: "Jotai",
    badge: "atoms, no cache library",
    tagline:
      "No fetching library at all: async atoms are the cache, filters and the selected task are atoms too, and the team is part of the scope every read depends on — so switching teams is a write, not an eviction. Client-owned.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          use-lane · live demo
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">
          One team-task workspace, five implementations.
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">
          The same UI and the same backend, built five ways —{" "}
          <span className="text-foreground">use-lane</span> server-owned,
          use-lane client-owned, the TanStack Query baseline, a Relay GraphQL
          variant, and plain jotai atoms — so you can feel the difference. Switch
          by changing the route. The first two are the same library on opposite
          sides of one question: who owns the data the screen is reading?
        </p>
      </header>

      <ul className="space-y-3">
        {VARIANTS.map((variant) => (
          <li key={variant.href}>
            <Link href={variant.href} className="group block">
              <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4 transition-colors group-hover:border-foreground/30">
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
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-dashed bg-card/50 px-5 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Router lab</span>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            separate · not the workspace
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            /lane-router
          </code>
        </div>
        <p className="mt-1 text-pretty text-muted-foreground">
          A focused mini-SPA (users / posts) running as a hash-routed client
          island: React Router v8 Data mode loaders publish into Lane, the UI reads
          via{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            loader: external
          </code>
          . Shows back/forward without a fallback flash, and that server-owned is
          not the same as server-side — here the owner is a client router, and a
          mutation lands by revalidating it.{" "}
          <Link
            href="/lane-router"
            className="text-foreground underline underline-offset-4"
          >
            Open →
          </Link>
        </p>
      </div>

      <div className="rounded-xl border border-dashed bg-card/50 px-5 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Infinite scroll lab</span>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            separate · not the workspace
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            /infinite
          </code>
        </div>
        <p className="mt-1 text-pretty text-muted-foreground">
          A measurement rig for paginated lists, on its own generated feed: page
          size, latency, sort, cursor semantics and injected failures as knobs,
          and a request log that draws every call on a shared time axis. Built to
          watch what{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            useInfiniteQuery
          </code>{" "}
          really does when you invalidate a five-page list — before use-lane
          grows an API for it.{" "}
          <Link
            href="/infinite"
            className="text-foreground underline underline-offset-4"
          >
            Open →
          </Link>
        </p>
      </div>

      <footer className="text-sm text-muted-foreground">
        Docs:{" "}
        <a
          className="underline underline-offset-4 hover:text-foreground"
          href="https://github.com/KentoMoriwaki/lane"
          target="_blank"
          rel="noreferrer"
        >
          github.com/KentoMoriwaki/lane
        </a>
      </footer>
    </main>
  );
}
