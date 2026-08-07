"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import { useInfiniteLane } from "use-lane";
import type { TaskPage, TaskScope } from "@/server/api";
import type { WorkspaceCtx } from "@/lib/lane-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTaskAction, refreshFirstPageAction } from "./api/actions";
import { fetchTaskPage, type TaskPageFilters } from "./api/endpoints";
import { taskInfiniteRead } from "./api/lane-reads";
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
 * There are exactly two moving parts, and no effect:
 *
 * 1. `firstPage` arrives as a prop — a resolved value the route already
 *    loaded. The loader's page-1 branch returns it. No fetch, no publication,
 *    no wait.
 * 2. `firstPage.version` is in the key. So a republication that changed page 1
 *    *is* a different key, and Lane reads the new entry during the render that
 *    carries the new prop — inside whatever transition the Server Action or the
 *    navigation is already running. The list resets to depth 1 and costs
 *    nothing. A republication that changed nothing keeps the key, and the
 *    user's depth with it.
 *
 * The previous revision of this spike published page 1 under an external key
 * and reconciled with an effect. That version worked, and cost: a
 * two-dimensional `(key, publication)` ref guard to survive filter changes and
 * `<Activity>` reveals, an N−1 request re-walk on every republication —
 * including the ones that changed nothing — and a visible window where a
 * reader of the publication and the list disagreed. Keying on a
 * server-computed content hash removes all three, at the price of discarding
 * pages 2..N when page 1 genuinely changes.
 *
 * That last cost is a product decision, so it stays available rather than
 * being taken away: **Deep refresh** below is the explicit `invalidate` that
 * re-walks the whole chain in place, the old behavior, on demand.
 *
 * `/lane-infinite/late` is the same component fed from a *publication* instead
 * of a prop — the pattern is about the value, not about where it came from.
 */
export function HybridTaskList({
  ctx,
  firstPage,
  scope,
  source,
}: {
  ctx: WorkspaceCtx;
  firstPage: TaskPage;
  scope: TaskScope;
  /** Where `firstPage` came from — labels the rig, changes nothing. */
  source: "prop" | "publication";
}) {
  const router = useRouter();
  const filters = React.useMemo<TaskPageFilters>(() => ({ scope }), [scope]);

  const { invalidate, isInvalidationPending, loadMore, promise } =
    useInfiniteLane(
      taskInfiniteRead(filters, firstPage, {
        nextPage: async (cursor, { meta, signal }) => {
          const page = await fetchTaskPage(meta, filters, { cursor }, signal);
          recordProbe("network", cursor, page);
          return page;
        },
        onAdoptFirstPage: (page) => recordProbe("adopt", null, page),
      }),
    );
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

      <IncomingPage
        firstPage={firstPage}
        listPage={adopted}
        source={source}
      />
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
