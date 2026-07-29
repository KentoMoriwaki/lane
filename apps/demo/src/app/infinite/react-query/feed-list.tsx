"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/feed/schema";
import type { useDatasetMutations } from "../_lab/dataset";
import {
  FEED_SCROLLER_CLASS,
  FeedRow,
  ListIntegrity,
  PageSeparator,
  annotateItems,
} from "../_lab/feed-rows";
import type { FeedParams } from "../_lab/types";
import { feedInfiniteOptions } from "./query-options";

/**
 * The list, the way TanStack Query renders a list.
 *
 * Everything about *how loading and failure are expressed* lives here on
 * purpose: skeletons while `status === "pending"`, an inline banner when
 * `status === "error"` but pages are still cached, a full error state when
 * nothing is, and a row of live boolean flags. That is react-query's model —
 * a status object you branch on — and the lab shows it as-is rather than
 * flattening it into something a second library would also have to produce.
 *
 * (The lane variant will render this region completely differently: suspending
 * for the first page, throwing the initial error to an Error Boundary, and
 * showing pending state from a transition. Nothing here is in its way.)
 */
export function FeedList({
  feed,
  staleTime,
  autoLoad,
  mutations,
}: {
  feed: FeedParams;
  staleTime: number;
  autoLoad: boolean;
  mutations: ReturnType<typeof useDatasetMutations>;
}) {
  const query = useInfiniteQuery(feedInfiniteOptions(feed, staleTime));

  const pages = query.data?.pages ?? [];
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const annotations = useMemo(
    () => annotateItems(items, feed.sort),
    [items, feed.sort],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { fetchNextPage, hasNextPage, isFetching } = query;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;

    if (!autoLoad || !sentinel || !root || !hasNextPage || isFetching) {
      return;
    }

    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { root, rootMargin: "120px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoad, hasNextPage, isFetching, fetchNextPage]);

  const handleRename = (item: FeedItem) => void mutations.rename(item);
  const handleDelete = (item: FeedItem) => void mutations.remove(item);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold">Accumulated list</h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Flag label="status" value={query.status} />
          <Flag label="fetchStatus" value={query.fetchStatus} />
          <Flag label="isFetching" value={query.isFetching} />
          <Flag label="isFetchingNextPage" value={query.isFetchingNextPage} />
          <Flag label="isRefetching" value={query.isRefetching} />
          <Flag label="hasNextPage" value={query.hasNextPage} />
        </div>
      </header>

      <ListIntegrity annotations={annotations}>
        <span>
          <strong className="font-mono text-foreground">{pages.length}</strong>{" "}
          pages
        </span>
        <span>
          <strong className="font-mono text-foreground">{items.length}</strong>{" "}
          rows
        </span>
      </ListIntegrity>

      {query.error && pages.length > 0 ? (
        <p className="rounded-lg border border-rose/40 bg-rose/5 px-3 py-2 text-xs text-rose">
          {query.error.message} — the pages already loaded are still on screen.
        </p>
      ) : null}

      <div
        ref={scrollRef}
        // The auto-load sentinel is observed against this element, so it only
        // fires when the reader actually reaches the bottom of the list.
        className={FEED_SCROLLER_CLASS}
      >
        {query.status === "pending" ? (
          <ul className="divide-y">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="space-y-2 px-3 py-3">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </li>
            ))}
          </ul>
        ) : query.status === "error" && pages.length === 0 ? (
          <div className="space-y-3 px-4 py-8 text-center">
            <p className="text-sm text-rose">{query.error.message}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              Refetch
            </Button>
          </div>
        ) : (
          <>
            {pages.map((page, pageIndex) => {
              const offset = pages
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
              {query.hasNextPage ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage
                    ? "Loading next page…"
                    : `Load page ${pages.length + 1}`}
                </Button>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  End of the feed — {items.length} rows loaded.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** react-query's status flags, printed verbatim. */
function Flag({ label, value }: { label: string; value: boolean | string }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono",
        value === true
          ? "border-cobalt/40 bg-cobalt/10 text-cobalt"
          : "border-border bg-muted/60 text-muted-foreground",
      )}
    >
      {label}
      <span className="ml-1 text-foreground">{String(value)}</span>
    </span>
  );
}
