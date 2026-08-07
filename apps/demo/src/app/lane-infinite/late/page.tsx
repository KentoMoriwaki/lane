import Link from "next/link";
import { Suspense } from "react";
import { LaneHydration } from "use-lane";
import { getCachedCurrentUser } from "../api/cached-endpoints";
import {
  fetchTaskPage,
  parseTaskPageScope,
  type TaskPageFilters,
} from "../api/endpoints";
import { InfiniteLaneProvider } from "../lane-provider";
import { PublishedTaskList } from "./published-list";
import { publishedFirstPageSnapshots } from "./published-first-page";

/**
 * **The published-first-page variant**, and the one thing a prop cannot do.
 *
 * `/lane-infinite` hands page 1 down as a prop, which is the right answer
 * whenever the loader and the list are in the same tree. This rig is the case
 * where they are not: the reader is a *sibling above* the publisher, so there is
 * no prop to pass, and the publication is deliberately a second and a half late,
 * so the reader is on screen before the value exists.
 *
 * Two things are being demonstrated, and they are separable:
 *
 * 1. **The external wait composes.** The reader suspends on a key nobody has
 *    published yet — boundary fallback, no request — and is settled by the
 *    publication when it arrives. No timeout, no double fetch, no error.
 * 2. **The pattern does not change.** Once `use()` has unwrapped the
 *    publication, the list below is the same component the prop form renders,
 *    keyed on the same `firstPage.version`. A republication that changed the
 *    page re-keys the list; one that did not, does not. Delivery and
 *    convergence are independent concerns, and this rig is what proves it.
 *
 * Nothing here is how a real page would be built. It is the shape of the
 * problem, stripped to the part that is hard.
 */

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function LatePublicationPage({ searchParams }: PageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <Link
          href="/lane-infinite"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← the prop form
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Published first page, late
        </h1>
        <p className="text-sm text-muted-foreground">
          The reader mounts first and waits; the publication streams in 1.5s
          later from a sibling boundary. Everything below the unwrap is the same
          component the prop form renders.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm">Resolving session…</p>}>
        <LateShell searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LateShell({ searchParams }: PageProps) {
  const raw = (await searchParams).scope;
  const scope = parseTaskPageScope(Array.isArray(raw) ? raw[0] : raw);
  const filters: TaskPageFilters = { scope };
  const user = await getCachedCurrentUser("");
  const ctx = { teamId: user.defaultTeamId, userId: user.id };

  return (
    <InfiniteLaneProvider ctx={ctx}>
      {/* The reader. Mounts and suspends before anything has been published. */}
      <Suspense
        fallback={
          <p data-testid="waiting" className="text-sm text-muted-foreground">
            Waiting for the publication…
          </p>
        }
      >
        <PublishedTaskList ctx={ctx} filters={filters} scope={scope} />
      </Suspense>
      {/* The publisher, a second and a half behind it. */}
      <Suspense fallback={null}>
        <LatePublication ctx={ctx} filters={filters} />
      </Suspense>
    </InfiniteLaneProvider>
  );
}

async function LatePublication({
  ctx,
  filters,
}: {
  ctx: { teamId: string; userId: string };
  filters: TaskPageFilters;
}) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const firstPage = await fetchTaskPage(ctx, filters, { cursor: null });

  return (
    <LaneHydration snapshots={publishedFirstPageSnapshots(filters, firstPage)}>
      {null}
    </LaneHydration>
  );
}
