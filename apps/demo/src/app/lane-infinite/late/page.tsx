import Link from "next/link";
import { Suspense } from "react";
import { LaneHydration } from "use-lane";
import { getCachedCurrentUser } from "../api/cached-endpoints";
import {
  fetchTaskPage,
  parseTaskPageScope,
  type TaskPageFilters,
} from "../api/endpoints";
import { taskPageSnapshots } from "../api/lane-reads";
import { HybridTaskList } from "../hybrid-task-list";
import { InfiniteLaneProvider } from "../lane-provider";

/**
 * **The "does the external wait compose?" case.**
 *
 * The same hybrid list, with the tree deliberately inverted: the reader is a
 * *sibling above* the publication rather than a child of it, and the
 * publication is slowed down by a second and a half. So the infinite lane's
 * loader runs while `["tasks-page1", filters]` holds nothing at all — its page-1
 * branch chains onto the external *wait*, and the whole read suspends on it.
 *
 * The question that answers: is adopting a published promise a special case
 * that only works once the value is already there? It should not be — an
 * external read is a loader like any other and the publication settles it by
 * replacement — but "page 1 comes from a promise the client did not create" is
 * exactly the kind of thing that works on a warm cache and deadlocks on a cold
 * one, so the spike measures it rather than assuming it.
 *
 * (This is not how the main route is built. `/lane-infinite` puts the reader
 * under the boundary, which is the shape any real page would use.)
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
          ← hybrid infinite list
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Late publication
        </h1>
        <p className="text-sm text-muted-foreground">
          The reader mounts first and waits; the publication streams in 1.5s
          later from a sibling boundary.
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
        <HybridTaskList ctx={ctx} scope={scope} />
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
    <LaneHydration snapshots={taskPageSnapshots(filters, firstPage)}>
      {null}
    </LaneHydration>
  );
}
