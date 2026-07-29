"use client";

import { infiniteQueryOptions } from "@tanstack/react-query";
import { fetchFeedPage } from "../_lab/feed-client";
import type { FeedParams } from "../_lab/types";

/**
 * The feed as TanStack Query sees it.
 *
 * One shared options factory, used by the list and by the cache controls so
 * both agree on the key — the ordinary way a v5 codebase is organised. Nothing
 * clever: `pageParam` *is* the cursor, `getNextPageParam` returns the cursor the
 * server handed back, and the query key is the parameters that decide which
 * rows the endpoint returns. If the refetch behaviour turns out to be
 * surprising, it has to be react-query's behaviour and not ours.
 *
 * Two options are lab decisions rather than defaults worth copying blindly:
 *
 * - `retry: false` — the default (3 attempts with backoff) would bury an
 *   injected failure under retry traffic in the request log.
 * - `staleTime` is passed in, because "does a remount refetch or repaint from
 *   cache?" is one of the experiments.
 */
export const feedKeys = {
  all: ["infinite-lab", "feed"] as const,
  list: (feed: FeedParams) => [...feedKeys.all, feed] as const,
};

export function feedInfiniteOptions(feed: FeedParams, staleTime: number) {
  return infiniteQueryOptions({
    queryKey: feedKeys.list(feed),
    queryFn: ({ pageParam, signal }) =>
      fetchFeedPage({ cursor: pageParam, feed, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
