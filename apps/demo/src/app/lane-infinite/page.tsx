import Link from "next/link";
import { Suspense } from "react";
import { LaneHydration } from "use-lane";
import {
  getCachedCurrentUser,
  getCachedFirstTaskPage,
} from "./api/cached-endpoints";
import { parseTaskPageScope, type TaskPageFilters } from "./api/endpoints";
import { taskPageSnapshots } from "./api/lane-reads";
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
 * Lane refuses to let one key be both. So the route publishes page 1 under its
 * own external key and the browser runs `useInfiniteLane` on a separate,
 * client-owned key whose `fetchPage` adopts that publication for page 1 and
 * fetches for the rest. See `api/lane-reads.ts` for the seam and
 * `hybrid-task-list.tsx` for the convergence effect.
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
          The App Router owns page 1 and publishes it; a client-owned
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            useInfiniteLane
          </code>
          owns the depth and adopts that publication instead of fetching it.
        </p>
      </header>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading publication…</p>}>
        <FirstPagePublication searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * The publication. Below the page-level boundary because `searchParams` is URL
 * data, so the shell above streams first.
 *
 * The value published here is *exactly* what the browser's `fetchPage` returns
 * for pages 2..N — same endpoint, same function, same `TaskPage`. That is not a
 * nicety: the pages end up in one `pages: P[]`, so a server-shaped page 1 and a
 * client-shaped page 2 would be a type error at best and a rendering bug at
 * worst. `laneSnapshot` checks the pair against the read the browser uses.
 */
async function FirstPagePublication({ searchParams }: PageProps) {
  const scope = parseTaskPageScope(
    normalize((await searchParams).scope),
  );
  const filters: TaskPageFilters = { scope };
  const user = await getCachedCurrentUser("");
  const ctx = { teamId: user.defaultTeamId, userId: user.id };
  const firstPage = await getCachedFirstTaskPage(ctx, filters);
  const snapshots = taskPageSnapshots(filters, firstPage);

  return (
    <InfiniteLaneProvider ctx={ctx}>
      <LaneHydration snapshots={snapshots}>
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Reading the lane…</p>
          }
        >
          <HybridTaskList ctx={ctx} scope={scope} />
        </Suspense>
      </LaneHydration>
    </InfiniteLaneProvider>
  );
}

function normalize(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
