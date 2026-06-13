import Link from "next/link";

type Variant = {
  href: string;
  name: string;
  tagline: string;
  available: boolean;
};

const VARIANTS: Variant[] = [
  {
    href: "/lane",
    name: "use-lane",
    tagline:
      "Promise-identity cache. Reads run through React transitions; Suspense, Error Boundaries, and useOptimistic own the UI.",
    available: true,
  },
  {
    href: "/react-query",
    name: "TanStack Query",
    tagline:
      "The baseline: a resolved-value cache with its own query/mutation hooks, status objects, and optimistic patches.",
    available: true,
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
          One team-task workspace, two data layers.
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">
          The same UI and the same backend, implemented with{" "}
          <span className="text-foreground">use-lane</span> and TanStack Query —
          so you can feel the difference. Switch the data layer by changing the
          route.
        </p>
      </header>

      <ul className="space-y-3">
        {VARIANTS.map((variant) => {
          const card = (
            <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4 transition-colors group-hover:border-foreground/30">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{variant.name}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {variant.href}
                  </code>
                  {!variant.available && (
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      coming soon
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {variant.tagline}
                </p>
              </div>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            </div>
          );

          return (
            <li key={variant.href}>
              {variant.available ? (
                <Link href={variant.href} className="group block">
                  {card}
                </Link>
              ) : (
                <div className="cursor-not-allowed opacity-50">{card}</div>
              )}
            </li>
          );
        })}
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
