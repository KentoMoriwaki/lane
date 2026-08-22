import Link from "next/link";

type Variant = {
  href: string;
  name: string;
  badge: string;
  tagline: string;
};

type VariantGroup = {
  eyebrow: string;
  title: string;
  description: string;
  variants: Variant[];
};

const PRIMARY_GROUPS: VariantGroup[] = [
  {
    eyebrow: "App Router integration",
    title: "The route owns each data generation",
    description:
      "Next resolves the reads and owns every generation of the data. What differs is how a mutation converges: through a re-rendered route, or through the client for what the response already answered. Plain App Router ↔ use-lane is the controlled comparison; the TanStack Query lab shows what changes when that generation is merged into a browser cache.",
    variants: [
      {
        href: "/app-router",
        name: "Plain App Router",
        badge: "Next → props",
        tagline:
          "The baseline: ordinary server values flow through client components as props, and every mutation re-renders the route. No Lane and no client data cache.",
      },
      {
        href: "/lane",
        name: "use-lane",
        badge: "Next → external reads",
        tagline:
          "The same reads and latency as the baseline, distributed through keyed external reads. A task edit lands from the API response in place; only what derives from it asks the route for another publication.",
      },
      {
        href: "/react-query-rsc",
        name: "TanStack Query + RSC",
        badge: "integration lab",
        tagline:
          "Each authoritative server generation is dehydrated into one long-lived browser QueryClient, making the ownership bridge and its effect-time merge observable.",
      },
    ],
  },
  {
    eyebrow: "Client data application",
    title: "The browser owns every workspace key",
    description:
      "Both SPAs ship only a static shell. After hydration, browser loaders call the same API and the client cache must patch safe results and invalidate only the data it cannot derive.",
    variants: [
      {
        href: "/lane-spa",
        name: "use-lane",
        badge: "Lane owns the cache",
        tagline:
          "Promise-first reads feed Suspense directly; transitions replace cached promises, and mutation results update matching lists in place.",
      },
      {
        href: "/react-query",
        name: "TanStack Query",
        badge: "QueryClient owns the cache",
        tagline:
          "The conventional SPA baseline with browser queryFns, optimistic writes, and targeted invalidation in one mutable store.",
      },
    ],
  },
];

const REFERENCE_VARIANTS: Variant[] = [
  {
    href: "/relay",
    name: "Relay",
    badge: "normalized GraphQL store",
    tagline:
      "A Suspense and Transition reference with fragment colocation, preloaded queries, and @defer streaming.",
  },
  {
    href: "/jotai",
    name: "Jotai",
    badge: "async atoms",
    tagline:
      "A client-owned reference with no fetching library: atoms model both remote data and workspace state.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-16">
      <header className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          use-lane · live demo
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">
          One workspace. Two ownership questions.
        </h1>
        <p className="max-w-3xl text-pretty text-lg text-muted-foreground">
          First choose who owns freshness: the App Router or the browser. Then
          compare how <span className="text-foreground">use-lane</span> carries
          that owner's promises through Suspense and Transitions. Every route
          below renders the same task workspace against the same backend.
        </p>
      </header>

      <div className="space-y-12">
        {PRIMARY_GROUPS.map((group, index) => (
          <section key={group.eyebrow} className="space-y-5">
            <div className="max-w-3xl space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {index + 1}. {group.eyebrow}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">
                {group.title}
              </h2>
              <p className="text-pretty text-sm leading-6 text-muted-foreground">
                {group.description}
              </p>
            </div>
            <ul
              className={`grid gap-3 md:grid-cols-2 ${
                group.variants.length === 3 ? "lg:grid-cols-3" : ""
              }`}
            >
              {group.variants.map((variant) => (
                <VariantCard key={variant.href} variant={variant} />
              ))}
            </ul>
          </section>
        ))}

        <section className="space-y-5 border-t pt-10">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Reference implementations
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">
              Other client-owned stores
            </h2>
            <p className="text-pretty text-sm leading-6 text-muted-foreground">
              These are useful behavioral yardsticks, not the primary Lane ↔
              TanStack Query comparison.
            </p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {REFERENCE_VARIANTS.map((variant) => (
              <VariantCard key={variant.href} variant={variant} />
            ))}
          </ul>
        </section>
      </div>

      <section className="grid gap-3 border-t pt-10 md:grid-cols-2">
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
            island: React Router v8 Data mode loaders publish into Lane, the UI
            reads via{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              loader: external
            </code>
            . Shows back/forward without a fallback flash, and that server-owned
            is not the same as server-side — here the owner is a client router,
            and a mutation lands by revalidating it.{" "}
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
            A measurement rig for paginated lists, on its own generated feed:
            page size, latency, sort, cursor semantics and injected failures as
            knobs, and a request log that draws every call on a shared time
            axis. Built to watch what{" "}
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
      </section>

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

function VariantCard({ variant }: { variant: Variant }) {
  return (
    <li>
      <Link href={variant.href} className="group block h-full">
        <div className="flex h-full items-start justify-between gap-4 rounded-xl border bg-card px-5 py-4 transition-colors group-hover:border-foreground/30">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{variant.name}</span>
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {variant.badge}
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {variant.href}
              </code>
            </div>
            <p className="text-sm leading-5 text-muted-foreground">
              {variant.tagline}
            </p>
          </div>
          <span aria-hidden className="mt-0.5 text-muted-foreground">
            →
          </span>
        </div>
      </Link>
    </li>
  );
}
