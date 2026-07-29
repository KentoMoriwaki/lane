"use client";

import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { FeedPageResponse } from "@/server/feed/schema";
import { ControlGroup, ControlRow, NumberSelect } from "../_lab/controls";
import type { useDatasetMutations } from "../_lab/dataset";
import { prependFeedItem } from "../_lab/feed-client";
import type { FeedParams } from "../_lab/types";
import { feedKeys } from "./query-options";

/**
 * Cache operations, which in TanStack Query means the QueryClient.
 *
 * These live outside the list subtree deliberately: `invalidateQueries` and the
 * cached page count have to keep working while the list is unmounted, since
 * "what does the cache still hold with no observer?" is one of the experiments.
 * They are react-query concepts end to end — another library would express the
 * same intentions completely differently, or not have them at all — so none of
 * it belongs in the shared lab.
 */
export function QueryCacheControls({
  feed,
  staleTime,
  onStaleTimeChange,
  mutations,
}: {
  feed: FeedParams;
  staleTime: number;
  onStaleTimeChange: (staleTime: number) => void;
  mutations: ReturnType<typeof useDatasetMutations>;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => feedKeys.list(feed), [feed]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
  };

  return (
    <ControlGroup
      title="TanStack Query cache"
      note="One entry holding { pages, pageParams }, operated through the QueryClient."
    >
      <ControlRow
        label="staleTime"
        note="Decides whether remounting the list repaints from cache or goes back to the network."
      >
        <NumberSelect
          value={staleTime}
          options={[0, 5_000, 60_000]}
          format={(value) =>
            value === 0 ? "0 (always stale)" : `${value / 1000}s`
          }
          onChange={onStaleTimeChange}
        />
      </ControlRow>

      <ControlRow
        label="Invalidate the whole list"
        note="With N pages loaded, count the bars this produces and check whether they start together or one after the other."
      >
        <Button size="xs" variant="outline" onClick={invalidate}>
          Invalidate
        </Button>
      </ControlRow>

      <ControlRow
        label="Insert a row, then invalidate"
        note="Compare the row at each page boundary before and after, and watch the duplicate / skipped counters above the list."
      >
        <Button
          size="xs"
          variant="outline"
          disabled={mutations.busy !== null}
          onClick={() =>
            void mutations.run("Inserting a row at the head", async () => {
              await prependFeedItem();
              invalidate();
            })
          }
        >
          Prepend + invalidate
        </Button>
      </ControlRow>

      <ControlRow
        label="Remove the cache entry"
        note="Evicts the pages outright; the next mount starts from the first page again."
      >
        <Button
          size="xs"
          variant="outline"
          onClick={() => queryClient.removeQueries({ queryKey })}
        >
          Drop
        </Button>
      </ControlRow>
    </ControlGroup>
  );
}

/**
 * How many pages the cache is holding, read straight from the QueryCache.
 * Subscribing to the cache rather than to a hook is why this number keeps
 * updating with no observer mounted.
 */
export function CachedPagesCard({ feed }: { feed: FeedParams }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => feedKeys.list(feed), [feed]);

  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );

  const getSnapshot = useCallback(() => {
    const data =
      queryClient.getQueryData<InfiniteData<FeedPageResponse, string | null>>(
        queryKey,
      );

    return data?.pages.length ?? null;
  }, [queryClient, queryKey]);

  const cachedPageCount = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null,
  );

  return (
    <section className="rounded-xl border bg-card p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide">
        Query cache
      </h2>
      <p className="mt-1 text-sm">
        {cachedPageCount === null ? (
          <span className="text-muted-foreground">
            Nothing cached for this query key.
          </span>
        ) : (
          <>
            <strong className="font-mono">{cachedPageCount}</strong> page
            {cachedPageCount === 1 ? "" : "s"} held for{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              limit={feed.limit} sort={feed.sort} cursor={feed.cursorMode}
            </code>
          </>
        )}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Read from the QueryCache, so it keeps updating while the list is
        unmounted.
      </p>
    </section>
  );
}
