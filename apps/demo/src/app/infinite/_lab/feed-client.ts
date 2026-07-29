"use client";

import type {
  FeedMutationResponse,
  FeedPageResponse,
} from "@/server/feed/schema";
import { beginRequest, settleRequest } from "./request-log";
import type { FeedParams, TransportKnobs } from "./types";

/**
 * The lab's HTTP layer. Every request the page makes goes through `labFetch`,
 * which records it in the request log before it leaves and settles the entry
 * when it lands.
 *
 * This is the one thing every variant must share, and the reason it can be
 * shared is that it sits *below* every library: the log has no idea whether the
 * caller was `useInfiniteQuery`, a lane, or a button handler — only that a
 * request left at time T with cursor C. When the lane variant is added it will
 * produce entries in exactly the same format on exactly the same timeline, with
 * no changes to this file and no adapter in between.
 */

const FEED_BASE = "/api/feed";

/**
 * Transport knobs are module state, read at request time, rather than
 * parameters threaded through the variant.
 *
 * The reason is experimental, not aesthetic: a variant will normally treat
 * `FeedParams` as the identity of the list, so anything routed through those
 * params discards the accumulated pages when it changes. Latency and `failAt`
 * must be adjustable *while five pages are already loaded* — "now make page 3
 * fail, now re-read" is the experiment. Keeping them out of band is the only
 * way to ask that question. They are set from the lab's settings panel.
 */
let transport: TransportKnobs = { latencyMs: 300, failAt: null };

export function setTransportKnobs(next: TransportKnobs): void {
  transport = next;
}

export class FeedRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly pageIndex: number | null;
  readonly seq: number | null;

  constructor(
    message: string,
    status: number,
    code: string | null,
    pageIndex: number | null,
    seq: number | null,
  ) {
    super(message);
    this.name = "FeedRequestError";
    this.status = status;
    this.code = code;
    this.pageIndex = pageIndex;
    this.seq = seq;
  }
}

/** Cursors are opaque base64url blobs; the log only needs them to be tellable apart. */
export function cursorLabel(cursor: string | null): string {
  if (!cursor) {
    return "start";
  }

  return cursor.length <= 14
    ? cursor
    : `${cursor.slice(0, 5)}…${cursor.slice(-7)}`;
}

type LabFetchSpec = {
  kind: "page" | "mutation";
  label: string;
  method: string;
  path: string;
  params?: URLSearchParams;
  body?: unknown;
  cursor?: string | null;
  signal?: AbortSignal;
};

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function labFetch<T>(spec: LabFetchSpec): Promise<T> {
  const query = spec.params?.toString();
  const url = `${FEED_BASE}${spec.path}${query ? `?${query}` : ""}`;
  const cursor = spec.cursor ?? null;

  const entryId = beginRequest({
    kind: spec.kind,
    label: spec.label,
    method: spec.method,
    url,
    cursor,
    cursorLabel: cursorLabel(cursor),
  });

  try {
    const response = await fetch(url, {
      method: spec.method,
      headers: spec.body === undefined ? undefined : { "content-type": "application/json" },
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      signal: spec.signal,
      cache: "no-store",
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;

    if (!response.ok) {
      const message =
        typeof payload?.error === "string"
          ? payload.error
          : `Request failed with ${response.status}`;
      const pageIndex =
        typeof payload?.pageIndex === "number" ? payload.pageIndex : null;
      const seq = typeof payload?.seq === "number" ? payload.seq : null;

      settleRequest(entryId, {
        outcome: "error",
        status: response.status,
        pageIndex,
        seq,
        message,
      });

      throw new FeedRequestError(
        message,
        response.status,
        typeof payload?.code === "string" ? payload.code : null,
        pageIndex,
        seq,
      );
    }

    const page = payload as unknown as Partial<FeedPageResponse> | null;

    settleRequest(entryId, {
      outcome: "ok",
      status: response.status,
      seq: typeof page?.seq === "number" ? page.seq : null,
      pageIndex: typeof page?.pageIndex === "number" ? page.pageIndex : null,
      itemCount: Array.isArray(page?.items) ? page.items.length : null,
      cursorResolution: page?.cursorResolution ?? null,
      nextCursorLabel:
        page?.nextCursor === undefined
          ? null
          : page.nextCursor === null
            ? "— end —"
            : cursorLabel(page.nextCursor),
    });

    return payload as T;
  } catch (error) {
    if (isAbortError(error)) {
      settleRequest(entryId, { outcome: "aborted", message: "aborted" });
    } else if (!(error instanceof FeedRequestError)) {
      settleRequest(entryId, {
        outcome: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    throw error;
  }
}

function transportParams(params: URLSearchParams): URLSearchParams {
  params.set("latency", String(transport.latencyMs));

  if (transport.failAt !== null) {
    params.set("failAt", String(transport.failAt));
  }

  return params;
}

export type FetchFeedPageArgs = {
  cursor: string | null;
  feed: FeedParams;
  signal?: AbortSignal;
};

export function fetchFeedPage({
  cursor,
  feed,
  signal,
}: FetchFeedPageArgs): Promise<FeedPageResponse> {
  const params = transportParams(
    new URLSearchParams({
      limit: String(feed.limit),
      sort: feed.sort,
      cursorMode: feed.cursorMode,
    }),
  );

  if (cursor) {
    params.set("cursor", cursor);
  }

  return labFetch<FeedPageResponse>({
    kind: "page",
    label: cursor ? "page @cursor" : "page @start",
    method: "GET",
    path: "/items",
    params,
    cursor,
    signal,
  });
}

function mutationParams(): URLSearchParams {
  return new URLSearchParams({ latency: String(transport.latencyMs) });
}

export function prependFeedItem(title?: string): Promise<FeedMutationResponse> {
  return labFetch<FeedMutationResponse>({
    kind: "mutation",
    label: "prepend",
    method: "POST",
    path: "/items",
    params: mutationParams(),
    body: title ? { title } : {},
  });
}

export function updateFeedItem(
  id: string,
  title: string,
): Promise<FeedMutationResponse> {
  return labFetch<FeedMutationResponse>({
    kind: "mutation",
    label: `rename ${id}`,
    method: "PATCH",
    path: `/items/${id}`,
    params: mutationParams(),
    body: { title },
  });
}

export function deleteFeedItem(id: string): Promise<FeedMutationResponse> {
  return labFetch<FeedMutationResponse>({
    kind: "mutation",
    label: `delete ${id}`,
    method: "DELETE",
    path: `/items/${id}`,
    params: mutationParams(),
  });
}

export function resetFeedDataset(): Promise<FeedMutationResponse> {
  return labFetch<FeedMutationResponse>({
    kind: "mutation",
    label: "reset dataset",
    method: "POST",
    path: "/reset",
    params: mutationParams(),
  });
}
