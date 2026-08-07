"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import { useInfiniteLane, useLane } from "use-lane";
import type { TaskPage, TaskScope } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTaskAction, refreshFirstPageAction } from "./api/actions";
import { fetchTaskPage, type TaskPageFilters } from "./api/endpoints";
import { taskInfiniteRead, taskPageReads, type TaskPageSource } from "./api/lane-reads";
import {
  getProbeEvents,
  getProbeServerSnapshot,
  recordProbe,
  resetProbe,
  setProbePhase,
  subscribeProbe,
} from "./probe";

const SCOPES: { label: string; value: TaskScope }[] = [
  { label: "All", value: "all" },
  { label: "Mine", value: "mine" },
  { label: "Unassigned", value: "unassigned" },
];

/**
 * **The hybrid list.** The App Router owns page 1; this component owns the
 * depth below it.
 *
 * Read it as three moves:
 *
 * 1. `useLane(taskPageReads.firstPage(filters))` — a read-only view of what the
 *    route published. No loader, no invalidate, no freshness options: the type
 *    does not offer them, because none of them mean anything for a key this
 *    client does not own.
 * 2. `taskInfiniteRead(filters, source)` — a *different*, client-owned key whose
 *    `fetchPage` branches on the initial cursor. `cursor === null` chains onto
 *    the published promise; every other cursor is an HTTP request. So the
 *    accumulated list is one value under one key, even though its first page
 *    came from somewhere the client may not write.
 * 3. The effect below — when the publication's promise identity changes, the
 *    client-owned key is invalidated and re-walks. Page 1 of that walk adopts
 *    the *new* publication, because `source` was rebuilt in the render that saw
 *    it, and Lane's re-read runs the latest committed loader.
 *
 * What makes (2) legal is that the two keys have different owners and neither
 * is written by the wrong side. Seeding `["tasks-infinite", …]` and calling
 * `loadMore` on it would be the configuration Lane refuses — `loadMore` appends
 * through `update`, and `update` on a published key throws.
 */
export function HybridTaskList({
  ctx,
  scope,
}: {
  ctx: WorkspaceCtx;
  scope: TaskScope;
}) {
  const router = useRouter();
  const filters = React.useMemo<TaskPageFilters>(() => ({ scope }), [scope]);

  // (1) The published page. `LaneExternalResult` — no `invalidate` on it at all.
  const { promise: firstPagePromise } = useLane(
    taskPageReads.firstPage(filters),
  );

  // The seam. Rebuilt whenever the publication changes identity, which is what
  // makes the re-walk below adopt the new one rather than the one this entry
  // was created with.
  const source = React.useMemo<TaskPageSource>(
    () => ({
      firstPage: () =>
        firstPagePromise.then((read) => {
          recordProbe("adopt", null, read.data);
          return read.data;
        }),
      nextPage: async (cursor, { meta, signal }) => {
        const page = await fetchTaskPage(meta, filters, { cursor }, signal);
        recordProbe("network", cursor, page);
        return page;
      },
    }),
    [filters, firstPagePromise],
  );

  // (2) The client-owned list.
  const { invalidate, isInvalidationPending, loadMore, promise } =
    useInfiniteLane(taskInfiniteRead(filters, source));
  const { data, refreshError } = React.use(promise);

  // (3) Converge on republication.
  //
  // Two guards, and both are load-bearing:
  //   - the first commit is skipped, because the entry was *created* from this
  //     publication — re-walking it would refetch what it just loaded;
  //   - a change of `scope` is skipped for the same reason one step out. The
  //     filter changes both keys at once, so the new publication and the new
  //     infinite entry arrive together and the entry already used it. Watching
  //     only the promise would fire a wasted re-walk on every filter click.
  const seen = React.useRef<{ promise: unknown; scope: TaskScope } | null>(null);
  React.useEffect(() => {
    const previous = seen.current;
    seen.current = { promise: firstPagePromise, scope };

    if (!previous || previous.scope !== scope) return;
    if (previous.promise === firstPagePromise) return;

    setProbePhase("re-walk (republication)");
    invalidate();
  }, [firstPagePromise, invalidate, scope]);

  const [isMutating, startMutation] = React.useTransition();
  const [title, setTitle] = React.useState("");

  const items = data.pages.flatMap((page) => page.items);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-2">
        {SCOPES.map((option) => (
          <Link
            key={option.value}
            href={
              option.value === "all"
                ? "/lane-infinite"
                : `/lane-infinite?scope=${option.value}`
            }
            className={`rounded-full border px-3 py-1 text-sm ${
              option.value === scope
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:border-foreground/40"
            }`}
          >
            {option.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {isInvalidationPending ? "re-walking…" : "idle"}
        </span>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          placeholder="New urgent task (republishes page 1)"
          onChange={(event) => setTitle(event.target.value)}
          className="max-w-xs"
          data-testid="new-task-title"
        />
        <Button
          data-testid="create-task"
          disabled={!title.trim() || isMutating}
          onClick={() => {
            const next = title.trim();
            if (!next) return;
            setTitle("");
            startMutation(async () => {
              await createTaskAction(ctx, next);
            });
          }}
        >
          Create + republish
        </Button>
        <Button
          variant="outline"
          data-testid="expire-republish"
          disabled={isMutating}
          onClick={() =>
            startMutation(async () => {
              await refreshFirstPageAction(ctx);
            })
          }
        >
          Expire + republish
        </Button>
        <Button
          variant="outline"
          data-testid="router-refresh"
          onClick={() => router.refresh()}
        >
          router.refresh() (cached page 1)
        </Button>
        <Button variant="ghost" data-testid="reset-probe" onClick={resetProbe}>
          Reset probe
        </Button>
      </section>

      {refreshError ? (
        <p
          data-testid="refresh-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
        >
          Refresh failed: {String(refreshError)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <React.Suspense fallback={null}>
          <PublishedBadge filters={filters} />
        </React.Suspense>
        <PageProvenance pages={data.pages} />
      </div>

      <ol data-testid="task-list" className="divide-y rounded-xl border">
        {items.map((task) => (
          <li key={task.id} className="px-4 py-3 text-sm">
            <span className="font-medium">{task.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {task.status} · {task.priority}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3">
        <Button
          data-testid="load-more"
          disabled={!data.hasNext || Boolean(refreshError)}
          onClick={() => {
            setProbePhase("loadMore");
            loadMore();
          }}
        >
          {data.hasNext ? "Load more" : "End of list"}
        </Button>
        <span
          data-testid="depth"
          className="text-xs text-muted-foreground"
        >
          {data.pages.length} page(s) · {items.length} row(s)
          {data.pages[0] ? ` · total ${data.pages[0].total}` : ""}
        </span>
      </div>

      <ProbeLog />
    </div>
  );
}

/**
 * The publication itself, read directly — the seam made visible.
 *
 * It exists to show the one thing this pattern cannot hide: the two keys do not
 * converge in the same commit. A republication lands here immediately (an
 * external reader is settled by the publication), while the list next to it
 * only moves once the invalidation-driven re-walk has finished. For the window
 * between them the badge shows the new page-1 stamp and the list still shows
 * the old one — which is fine when only one of them is on screen, and a visible
 * disagreement when both are.
 */
function PublishedBadge({ filters }: { filters: TaskPageFilters }) {
  const { promise } = useLane(taskPageReads.firstPage(filters));
  const { data } = React.use(promise);

  return (
    <span
      data-testid="published-badge"
      data-serve-seq-published={data.serveSeq}
      className="rounded border border-dashed px-2 py-1 text-xs text-muted-foreground"
    >
      published page 1 · seq {data.serveSeq} · total {data.total}
    </span>
  );
}

/**
 * Which server response each loaded page came from. Page 1's `serveSeq` is the
 * publication's; it must never change without a republication, and must always
 * change *with* one that expired the cache.
 */
function PageProvenance({ pages }: { pages: TaskPage[] }) {
  return (
    <ul
      data-testid="page-provenance"
      className="flex flex-wrap gap-2 text-xs text-muted-foreground"
    >
      {pages.map((page, index) => (
        <li
          key={`${page.serveSeq}-${index}`}
          data-testid={`page-${index + 1}-seq`}
          data-serve-seq={page.serveSeq}
          className="rounded border px-2 py-1"
        >
          page {index + 1} · seq {page.serveSeq} · {page.items.length} rows
          {index === 0 ? " · published" : " · fetched"}
        </li>
      ))}
    </ul>
  );
}

function ProbeLog() {
  const events = React.useSyncExternalStore(
    subscribeProbe,
    getProbeEvents,
    getProbeServerSnapshot,
  );
  const networkPageOne = events.filter(
    (event) => event.kind === "network" && event.cursor === null,
  ).length;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        Loader log —{" "}
        <span data-testid="network-total">
          {events.filter((event) => event.kind === "network").length}
        </span>{" "}
        network,{" "}
        <span data-testid="network-page-one">{networkPageOne}</span> of them for
        page 1
      </h2>
      <ol className="space-y-1 font-mono text-xs">
        {events.map((event) => (
          <li key={event.id}>
            #{event.id} [{event.phase}] {event.kind}{" "}
            {event.cursor === null ? "cursor=null (page 1)" : `cursor=${event.cursor}`}{" "}
            → seq {event.serveSeq}
          </li>
        ))}
      </ol>
    </section>
  );
}
