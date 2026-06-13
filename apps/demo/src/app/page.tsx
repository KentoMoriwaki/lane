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
    badge: "RSC-seeded",
    tagline:
      "Server-prefetched then hydrated; the client owns reads after first paint. Suspense, Error Boundaries, transitions, and useOptimistic own the UI.",
  },
  {
    href: "/lane-spa",
    name: "use-lane",
    badge: "client-only",
    tagline:
      "No server prefetch — the client owns every read from first paint. Same library, SPA architecture.",
  },
  {
    href: "/react-query",
    name: "TanStack Query",
    badge: "baseline",
    tagline:
      "The baseline: a resolved-value cache with its own query/mutation hooks, status objects, and optimistic patches.",
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
          One team-task workspace, three implementations.
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">
          The same UI and the same backend, built three ways —{" "}
          <span className="text-foreground">use-lane</span> server-seeded,
          use-lane client-only, and the TanStack Query baseline — so you can feel
          the difference. Switch by changing the route.
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
