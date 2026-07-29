"use client";

import type { InfiniteLaneValue } from "use-lane";
import type { FeedPageResponse } from "@/server/feed/schema";
import type { FeedParams } from "../_lab/types";

/**
 * The feed as a lane sees it: **one key holding the whole accumulated list**.
 *
 * There is no page number in the key and no page count in the component. The key
 * is the parameters that decide which rows the endpoint returns; the value under
 * it is every page loaded so far, and `useInfiniteLane` reads the depth back out
 * of that value whenever it re-reads — which is why this file is now three
 * declarations instead of a hand-rolled cursor walk.
 *
 * A cursor is `string | null` (`null` is the first page) and a page is the
 * server's response envelope, so the shared row rendering gets exactly the same
 * `FeedPageResponse` the react-query variant gives it.
 */
export type FeedCursor = string | null;

export type FeedValue = InfiniteLaneValue<FeedPageResponse, FeedCursor>;

export function feedKey(feed: FeedParams) {
  return ["feed", feed] as const;
}

export function itemsOf(value: FeedValue) {
  return value.pages.flatMap((page) => page.items);
}
