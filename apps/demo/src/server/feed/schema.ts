import { z } from "zod";

/**
 * Wire contract for the infinite-scroll lab feed (`/api/feed`).
 *
 * This is deliberately *not* part of the team-task API: the lab needs a large,
 * cheap, mutable dataset and a set of knobs (latency, injected failures, cursor
 * semantics) that would be noise in the product API. Nothing here touches
 * `server/team/*`.
 *
 * The client imports the types from this module with `import type`, so no zod
 * and no server runtime ends up in the browser bundle.
 */

export const feedSortValues = ["newest", "oldest", "title"] as const;
export type FeedSort = (typeof feedSortValues)[number];

/**
 * Two cursor semantics, because the difference is the whole point of the lab.
 *
 * - `keyset` — the cursor names the *last item of the previous page* ("resume
 *   after item X"). Rows inserted above that anchor do not shift the window, so
 *   a page-by-page refetch that re-derives every cursor self-heals.
 * - `offset` — the cursor is a positional snapshot ("resume at index 40").
 *   Inserting at the head shifts every later page by one, so refetching the
 *   list yields a duplicated row at each page boundary.
 *
 * Both are emitted as the same opaque base64url blob; the client never parses
 * one, it only echoes what the server handed it.
 */
export const cursorModeValues = ["keyset", "offset"] as const;
export type CursorMode = (typeof cursorModeValues)[number];

/**
 * How the server actually resolved the cursor it was handed. `offset-fallback`
 * is the interesting one: the keyset anchor no longer exists (its row was
 * deleted), so the server had to fall back to the positional snapshot baked
 * into the cursor.
 */
export const cursorResolutionValues = [
  "start",
  "anchor",
  "offset",
  "offset-fallback",
] as const;
export type CursorResolution = (typeof cursorResolutionValues)[number];

export const feedSortSchema = z.enum(feedSortValues);
export const cursorModeSchema = z.enum(cursorModeValues);

export type FeedAuthor = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type FeedItem = {
  id: string;
  /**
   * Position in the generated seed, or `null` for rows created at runtime.
   * The UI uses it to spot gaps and duplicates in the accumulated list without
   * having to trust the server's own accounting.
   */
  seedIndex: number | null;
  title: string;
  body: string;
  author: FeedAuthor;
  createdAt: string;
  updatedAt: string | null;
  origin: "seed" | "created";
  /** Bumped on every in-place edit, so a stale row is visible as a stale number. */
  revision: number;
};

/**
 * Every response carries enough provenance for the client to prove ordering
 * without guessing: the cursor it was called with, the 1-based page index the
 * server derived from that cursor, and a process-wide monotonic sequence
 * number stamped when the request is served.
 */
export type FeedResponseMeta = {
  seq: number;
  servedAt: string;
  requestedCursor: string | null;
  latencyMs: number;
  /** Dataset revision — bumped by every mutation, so drift has a version. */
  revision: number;
  total: number;
};

export type FeedPageResponse = FeedResponseMeta & {
  items: FeedItem[];
  nextCursor: string | null;
  pageIndex: number;
  cursorResolution: CursorResolution;
  sort: FeedSort;
  cursorMode: CursorMode;
  limit: number;
};

export type FeedMutationResponse = FeedResponseMeta & {
  item: FeedItem | null;
};

export type FeedErrorResponse = {
  error: string;
  code: string;
  seq?: number;
  pageIndex?: number;
};

const latency = z.coerce.number().int().min(0).max(10_000).default(0);

export const feedPageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: feedSortSchema.default("newest"),
  cursorMode: cursorModeSchema.default("keyset"),
  latency,
  /**
   * 1-based page index that should fail with a 500. The index is derived from
   * the cursor on the server, so the client does not have to tell us which page
   * it thinks it is asking for — it cannot lie about it either.
   */
  failAt: z.coerce.number().int().min(1).max(999).optional(),
});

/** Mutations take the same latency knob, so a write is as observable as a read. */
export const feedMutationQuerySchema = z.object({ latency });

export const createFeedItemInputSchema = z.object({
  title: z.string().min(1).max(160).optional(),
});

export const updateFeedItemInputSchema = z.object({
  title: z.string().min(1).max(160),
});
