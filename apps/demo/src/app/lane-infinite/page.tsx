import Link from "next/link";
import { Suspense } from "react";
import {
  getCachedCurrentUser,
  getCachedFirstTaskPage,
} from "./api/cached-endpoints";
import { parseTaskPageScope, type TaskPageFilters } from "./api/endpoints";
import { HybridTaskList } from "./hybrid-task-list";
import { InfiniteLaneProvider } from "./lane-provider";

/**
 * **The hybrid-ownership spike.** One screen, two owners.
 *
 * `/lane` is server-owned end to end and `/lane-spa` is client-owned end to
 * end. This route is the case neither of them covers: a paginated list whose
 * *first page* belongs to the route — it is what the URL is about, it should be
 * in the first paint, and it must converge when a Server Action changes it —
 * while its *depth* belongs to the browser, because "how far the user has
 * scrolled" is not something a server render knows or should re-derive.
 *
 * The seam is deliberately unremarkable: **page 1 is a prop.** No external key,
 * no `laneSnapshot`, no `LaneHydration`. The route loads the page and hands it
 * to the client component, which returns it from its infinite loader's page-1
 * branch and puts the page's server-computed `version` in the key. That is the
 * whole integration. See `api/lane-reads.ts`.
 *
 * Passing it as a prop is not a shortcut around Lane — it is the ownership rule
 * applied literally. Page 1 is *not read reactively by any client component*
 * (the list reads the accumulated value, not page 1), and the top row of
 * `docs/architectures.md#the-ownership-rule` says such a key does not belong in
 * a data layer at all: a prop is cheaper than a key. What Lane owns here is the
 * one thing that actually needs coordinating — the accumulated list.
 *
 * `/lane-infinite/late` keeps the publication form for the case where a prop
 * cannot reach the reader.
 */

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function Page({ searchParams }: PageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <Link
          href="/"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          ← demo index
        </Link>
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          use-lane · spike
        </p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          Hybrid infinite list
        </h1>
        <p className="text-pretty text-muted-foreground">
          The App Router owns page 1 and passes it down; a client-owned
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            useInfiniteLane
          </code>
          owns the depth and keys itself on that page&rsquo;s content hash, so a
          changed first page is a different list and an unchanged one keeps the
          depth.
        </p>
        <Link
          href="/lane-infinite/late"
          className="inline-block text-sm underline underline-offset-4"
        >
          → the published-first-page variant
        </Link>
      </header>

      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading page 1…</p>}
      >
        <FirstPage searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * Below the page-level boundary because `searchParams` is URL data, so the
 * shell above streams first.
 *
 * **Page 1 is handed over unawaited.** This component does not block on it; the
 * promise crosses to the client and the boundary below it is what waits. That is
 * not a micro-optimisation — it is what gives the client half a *stable
 * identity* for the incoming page. A resolved value is deserialized afresh on
 * every delivery and has no identity worth anything; the promise is one object
 * per delivery, which is what the interim wrapper is keyed on (see
 * `use-hybrid-infinite-lane.ts`).
 *
 * What it resolves to is *exactly* what the browser's `fetchPage` returns for
 * pages 2..N — same endpoint, same function, same `TaskPage`. The pages end up
 * in one `pages: P[]`, so a server-shaped page 1 and a client-shaped page 2
 * would be a rendering bug; the prop's type is what rules it out.
 */
async function FirstPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params.scope;
  const scope = parseTaskPageScope(Array.isArray(raw) ? raw[0] : raw);
  const filters: TaskPageFilters = { scope };
  // `?adoptDelay=800` stretches the adopting window so it can be clicked into.
  const adoptDelayMs = Number(
    Array.isArray(params.adoptDelay) ? params.adoptDelay[0] : params.adoptDelay,
  );
  const user = await getCachedCurrentUser("");
  const ctx = { teamId: user.defaultTeamId, userId: user.id };
  const firstPagePromise = getCachedFirstTaskPage(ctx, filters);

  return (
    <InfiniteLaneProvider ctx={ctx}>
      <Suspense
        fallback={
          <p data-testid="list-fallback" className="text-sm text-muted-foreground">
            Reading the lane…
          </p>
        }
      >
        <HybridTaskList
          adoptDelayMs={Number.isFinite(adoptDelayMs) ? adoptDelayMs : 0}
          ctx={ctx}
          firstPagePromise={firstPagePromise}
          scope={scope}
          source="prop"
        />
      </Suspense>
    </InfiniteLaneProvider>
  );
}
