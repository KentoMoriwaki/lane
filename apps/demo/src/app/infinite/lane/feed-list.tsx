"use client";

import { use, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { useInfiniteLane } from "use-lane";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FeedItem, FeedPageResponse } from "@/server/feed/schema";
import type { useDatasetMutations } from "../_lab/dataset";
import { fetchFeedPage } from "../_lab/feed-client";
import {
  FEED_SCROLLER_CLASS,
  FeedRow,
  ListIntegrity,
  PageSeparator,
  annotateItems,
} from "../_lab/feed-rows";
import type { FeedParams } from "../_lab/types";
import { feedKey, itemsOf, type FeedCursor } from "./feed-lane";

// How long a fetched page set stays fresh, and so what the `refetchOnMount`
// control's "when stale" position is gated on.
const FEED_STALE_TIME = 5_000;

/**
 * The list, the way a lane reads a list.
 *
 * There is no status object to branch on, so nothing here looks like the
 * react-query variant:
 *
 * - the first load **suspends** — the skeleton is the `<Suspense>` fallback the
 *   page puts above this component, not a `status === "pending"` branch;
 * - a first-load failure **throws** to the boundary above;
 * - a *re-read* that fails never throws: lane keeps serving the last fulfilled
 *   value and hands the failure back as `refreshError` in the same resolved
 *   value, rendered inline below;
 * - "refreshing" is `isTransitionPending`, which covers both a `loadMore` and a
 *   full re-read, and during which the committed list stays on screen.
 *
 * What is *not* here any more is the bookkeeping. An earlier version of this
 * file kept the page depth in a ref, incremented it after each successful
 * append, and reset it when the key changed — and still desynced whenever the
 * component remounted over a cache that outlived it. `useInfiniteLane` reads the
 * depth out of the cached value instead, so the component holds no state about
 * the list at all.
 */
export function FeedList({
  feed,
  autoLoad,
  loadMoreBurst,
  refetchOnMount,
  mutations,
}: {
  feed: FeedParams;
  autoLoad: boolean;
  loadMoreBurst: number;
  refetchOnMount: boolean | "always";
  mutations: ReturnType<typeof useDatasetMutations>;
}) {
  // The lab's settings are plain state in a component we do not own, so a sort
  // change arrives as an urgent update and would replace this list with the
  // Suspense fallback. Deferring the parameters locally is the documented answer
  // for "you don't own the source": the key AND the loader both derive from the
  // deferred value, so the old list stays live until the new one resolves.
  const deferredFeed = useDeferredValue(feed);
  const isSwappingParams = deferredFeed !== feed;

  const { promise, loadMore, isTransitionPending, isBackgroundPending } =
    useInfiniteLane<FeedPageResponse, FeedCursor>({
      key: feedKey(deferredFeed),
      fetchPage: (cursor, { signal }) =>
        fetchFeedPage({ cursor, feed: deferredFeed, signal }),
      initialCursor: null,
      nextCursor: (page) => page.nextCursor,
      refetchOnMount,
      // What makes the control's middle position mean anything: `true` refreshes
      // only stale values, and `staleTime` defaults to Infinity, so without one
      // "when stale" would never fire. A few seconds also keeps the three
      // positions distinguishable — off / stale-gated / every mount.
      staleTime: FEED_STALE_TIME,
    });

  const { data, refreshError } = use(promise);

  const items = useMemo(() => itemsOf(data), [data]);
  const annotations = useMemo(
    () => annotateItems(items, deferredFeed.sort),
    [items, deferredFeed.sort],
  );

  const isConverging = isTransitionPending || isBackgroundPending;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNext } = data;

  // The sentinel is a loop, and only a change in what it observes stops it. A
  // successful append stops it by adding rows and eventually clearing `hasNext`;
  // a *failed* one changes neither — the value is untouched, so `hasNext` is
  // still true and the pending flag drops back down — and without `refreshError`
  // in the gate the observer would re-fire forever against a server that is
  // already failing. All three facts come out of the same resolved value, so
  // they cannot disagree.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;

    if (
      !autoLoad ||
      !sentinel ||
      !root ||
      !hasNext ||
      isConverging ||
      refreshError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          for (let i = 0; i < loadMoreBurst; i += 1) {
            loadMore();
          }
        }
      },
      { root, rootMargin: "120px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoad, hasNext, isConverging, loadMore, loadMoreBurst, refreshError]);

  const handleRename = (item: FeedItem) => void mutations.rename(item);
  const handleDelete = (item: FeedItem) => void mutations.remove(item);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold">Accumulated list</h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Flag label="isTransitionPending" value={isTransitionPending} />
          <Flag label="isBackgroundPending" value={isBackgroundPending} />
          <Flag label="data.hasNext" value={hasNext} />
          <Flag label="params deferred" value={isSwappingParams} />
        </div>
        {isConverging ? (
          <span className="ml-auto animate-pulse text-[11px] font-medium text-cobalt">
            converging — this list is the previous value
          </span>
        ) : null}
      </header>

      <ListIntegrity annotations={annotations}>
        <span>
          <strong className="font-mono text-foreground">
            {data.pages.length}
          </strong>{" "}
          pages
        </span>
        <span>
          <strong className="font-mono text-foreground">{items.length}</strong>{" "}
          rows
        </span>
      </ListIntegrity>

      {refreshError ? (
        <p className="rounded-lg border border-rose/40 bg-rose/5 px-3 py-2 text-xs text-rose">
          refreshError:{" "}
          {refreshError instanceof Error
            ? refreshError.message
            : String(refreshError)}{" "}
          — the last value that loaded is still on screen, and this read is not
          in an error state.
        </p>
      ) : null}

      <div
        ref={scrollRef}
        // The auto-load sentinel is observed against this element, so it only
        // fires when the reader actually reaches the bottom of the list.
        className={cn(FEED_SCROLLER_CLASS, isConverging && "opacity-70")}
      >
        {data.pages.map((page, pageIndex) => {
          const offset = data.pages
            .slice(0, pageIndex)
            .reduce((total, previous) => total + previous.items.length, 0);

          return (
            <div key={`${page.seq}-${pageIndex}`}>
              <PageSeparator page={page} index={pageIndex + 1} />
              <ul className="divide-y">
                {page.items.map((item, itemIndex) => (
                  <FeedRow
                    key={`${page.seq}-${item.id}-${itemIndex}`}
                    item={item}
                    annotation={annotations[offset + itemIndex]}
                    busy={mutations.busyItemId === item.id}
                    onRename={handleRename}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            </div>
          );
        })}

        <div ref={sentinelRef} className="h-px" />

        <div className="px-3 py-3">
          {hasNext ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                // Fired synchronously, so a burst lands before React can
                // re-render this button into its disabled state — which is the
                // only way to observe what two overlapping calls do.
                for (let i = 0; i < loadMoreBurst; i += 1) {
                  loadMore();
                }
              }}
              disabled={isConverging}
            >
              {isConverging
                ? "Converging…"
                : `Load page ${data.pages.length + 1}`}
            </Button>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              End of the feed — {items.length} rows loaded.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Lane's two pending flags, plus the one piece of state that rides in the value. */
function Flag({ label, value }: { label: string; value: boolean }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono",
        value
          ? "border-cobalt/40 bg-cobalt/10 text-cobalt"
          : "border-border bg-muted/60 text-muted-foreground",
      )}
    >
      {label}
      <span className="ml-1 text-foreground">{String(value)}</span>
    </span>
  );
}
