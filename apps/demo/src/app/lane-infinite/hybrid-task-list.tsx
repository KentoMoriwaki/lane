"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import type { TaskPage, TaskScope } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTaskAction, refreshFirstPageAction } from "./api/actions";
import { fetchTaskPage, type TaskPageFilters } from "./api/endpoints";
import { taskListKey, taskPageVersion } from "./api/lane-reads";
import {
  getProbeEvents,
  getProbeServerSnapshot,
  recordInterim,
  recordProbe,
  resetProbe,
  setProbePhase,
  subscribeProbe,
} from "./probe";
import { SecondReader } from "./second-reader";
import { useHybridInfiniteLane } from "./use-hybrid-infinite-lane";

const SCOPES: { label: string; value: TaskScope }[] = [
  { label: "All", value: "all" },
  { label: "Mine", value: "mine" },
  { label: "Unassigned", value: "unassigned" },
];

/**
 * **The hybrid list.** The App Router owns page 1; this component owns the
 * depth below it.
 *
 * Page 1 arrives as an *unawaited promise* — the route hands over
 * `fetchTaskPage(...)` and lets it stream — and everything that follows from it
 * lives in `useHybridInfiniteLane`, a userland hook built on nothing but
 * `useInfiniteLane`, `lane.set` and React. Read that module for the mechanism;
 * what matters here is what the component gets:
 *
 * - a first paint with no client request for page 1;
 * - a republication that changed nothing costs nothing and keeps the depth;
 * - a republication that changed page 1 shows it immediately, at depth 1, with
 *   no request and no frame of the old list in between;
 * - `invalidate` still re-walks pages 2..N with page 1 for free.
 *
 * Three earlier revisions of this spike are worth remembering for what they
 * cost. The first published page 1 under an external key and reconciled with an
 * effect: a two-dimensional `(key, publication)` ref guard, an N−1 request
 * re-walk on *every* republication, and a visible two-truth window. The second
 * spliced the content hash into the key, which fixed all of that and cost `.key`
 * its reachability. The third put the whole thing in `packages/lane` and was
 * rejected for the weight it added to every entry in the store. This one needs
 * no core change at all.
 *
 * The trade that remains is deliberate: a changed first page discards pages
 * 2..N rather than re-deriving them. **Deep refresh** below is the explicit
 * `invalidate` that re-walks the chain in place, page 1 for free.
 *
 * `/lane-infinite/late` is the same component fed from a *publication* instead
 * of a route prop — the pattern is about the value, not where it came from.
 */
export function HybridTaskList({
  adoptDelayMs = 0,
  ctx,
  firstPagePromise,
  scope,
  source,
}: {
  /** `?adoptDelay=` — see `useHybridInfiniteLane`. Lab only. */
  adoptDelayMs?: number;
  ctx: WorkspaceCtx;
  /** Unawaited on purpose: the route streams it rather than blocking on it. */
  firstPagePromise: Promise<TaskPage>;
  scope: TaskScope;
  /** Where page 1 came from — labels the rig, changes nothing. */
  source: "prop" | "publication";
}) {
  const router = useRouter();
  const filters = React.useMemo<TaskPageFilters>(() => ({ scope }), [scope]);

  const {
    firstPage,
    invalidate,
    isAdopting,
    isInvalidationPending,
    loadMore,
    promise,
  } = useHybridInfiniteLane<TaskPage, string | null>({
    adoptDelayMs,
    key: taskListKey(filters),
    initialCursor: null,
    firstPagePromise,
    version: taskPageVersion,
    fetchPage: async (cursor, { meta, signal }) => {
      const page = await fetchTaskPage(meta, filters, { cursor }, signal);
      recordProbe("network", cursor, page);
      return page;
    },
    nextCursor: (page) => page.nextCursor,
    onAdoptFirstPage: (page) => recordProbe("adopt", null, page),
    onInterim: recordInterim,
  });
  const { data, refreshError } = React.use(promise);

  const adopted = data.pages[0];
  const [isMutating, startMutation] = React.useTransition();
  const [title, setTitle] = React.useState("");

  const items = data.pages.flatMap((page) => page.items);
  // Everything the list shows comes from `data.pages` — never from the
  // `firstPage` prop. They are the same content whenever the version matches,
  // and the prop is the *newer* object whenever it does not; rendering both
  // would put two truths back on the screen, which is exactly what dropping
  // the external key removed. The one exception is the instrument row below,
  // which exists to show the difference.

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
        <span data-testid="status" className="ml-auto text-xs text-muted-foreground">
          {isMutating
            ? "republishing…"
            : isAdopting
              ? "adopting…"
              : isInvalidationPending
                ? "re-walking…"
                : "idle"}
        </span>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          placeholder="New urgent task (changes page 1)"
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
            setProbePhase("create → republish");
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
          onClick={() => {
            setProbePhase("expire → republish (same content)");
            startMutation(async () => {
              await refreshFirstPageAction(ctx);
            });
          }}
        >
          Expire + republish
        </Button>
        <Button
          variant="outline"
          data-testid="router-refresh"
          onClick={() => {
            setProbePhase("router.refresh()");
            router.refresh();
          }}
        >
          router.refresh()
        </Button>
        <Button
          variant="secondary"
          data-testid="deep-refresh"
          onClick={() => {
            setProbePhase("deep invalidate");
            invalidate();
          }}
        >
          Deep refresh (re-walk)
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

      <div className="flex flex-wrap items-center gap-2">
        <IncomingPage firstPage={firstPage} listPage={adopted} source={source} />
        <React.Suspense fallback={null}>
          <SecondReader filters={filters} />
        </React.Suspense>
      </div>
      <PageProvenance pages={data.pages} />

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
        <span data-testid="depth" className="text-xs text-muted-foreground">
          {data.pages.length} page(s) · {items.length} row(s)
          {adopted ? ` · total ${adopted.total}` : ""}
        </span>
      </div>

      <ProbeLog />
    </div>
  );
}

/**
 * **The instrument, not the product UI.**
 *
 * It shows the incoming page 1 next to the one the list is actually holding,
 * because the one thing the value form does *not* remove is that the incoming
 * value is still a second copy. It is a copy that can only differ in ways the
 * version says do not matter — except that `servedAt` / `serveSeq` live inside
 * the same object and are *not* content, so after a republication that changed
 * nothing the incoming page is a strictly newer object describing the same
 * rows, and the entry rightly keeps the older one.
 *
 * Three states:
 *
 * - `AGREE` — same version, same serve. Nothing has happened since.
 * - `content agrees, provenance lags` — the desired outcome of an unchanged
 *   republication: the depth was kept, so the entry still holds the page it was
 *   built from. It is also the reason a real screen must render from
 *   `data.pages`, never from the incoming value: they are equal in everything a
 *   user can see and unequal in everything an instrument can.
 * - `RE-KEYING` — a changed page 1 that this render has not adopted yet. Should
 *   never be observable, since the key changes in the same render as the value.
 */
function IncomingPage({
  firstPage,
  listPage,
  source,
}: {
  firstPage: TaskPage;
  listPage: TaskPage | undefined;
  source: "prop" | "publication";
}) {
  const verdict =
    firstPage.version !== listPage?.version
      ? "RE-KEYING"
      : firstPage.serveSeq === listPage.serveSeq
        ? "AGREE"
        : "content agrees, provenance lags";

  return (
    <p
      data-testid="incoming-page"
      data-incoming-version={firstPage.version}
      data-incoming-seq={firstPage.serveSeq}
      data-list-version={listPage?.version ?? "—"}
      data-verdict={verdict}
      className="rounded border border-dashed px-2 py-1 font-mono text-xs text-muted-foreground"
    >
      incoming page 1 ({source}) · v{firstPage.version} · seq{" "}
      {firstPage.serveSeq} — list holds v{listPage?.version ?? "—"} · seq{" "}
      {listPage?.serveSeq ?? "—"} · {verdict}
    </p>
  );
}

/** Which server response each loaded page came from. */
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
          data-version={page.version}
          className="rounded border px-2 py-1"
        >
          page {index + 1} · seq {page.serveSeq} · {page.items.length} rows
          {index === 0 ? " · from the route" : " · fetched"}
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
        network, <span data-testid="network-page-one">{networkPageOne}</span> of
        them for page 1
      </h2>
      <ol className="space-y-1 font-mono text-xs">
        {events.map((event) => (
          <li key={event.id}>
            #{event.id} [{event.phase}] {event.kind}{" "}
            {event.cursor === null
              ? "cursor=null (page 1)"
              : `cursor=${event.cursor}`}{" "}
            → v{event.version} seq {event.serveSeq}
          </li>
        ))}
      </ol>
    </section>
  );
}
