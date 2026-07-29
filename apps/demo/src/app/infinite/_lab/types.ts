import type { CursorMode, FeedSort } from "@/server/feed/schema";

/**
 * Lab-level settings: everything the *server* is told to do, plus the two
 * toggles that describe how the page is being driven.
 *
 * There is deliberately nothing here about how a variant models, keys, or
 * renders its list. `_lab/` owns the measurement apparatus — the instrumented
 * fetch, the request log, the timeline, the row markup, the dataset buttons —
 * and each variant under `infinite/<library>/` writes the list the way that
 * library is actually written: react-query with status objects and a query key,
 * `use-lane` later with Suspense, Error Boundaries and transitions. Making the
 * two agree on a shared shape would mean measuring an adapter instead of a
 * library.
 */

/** The query parameters that decide *which rows* the server returns. */
export type FeedParams = {
  limit: number;
  sort: FeedSort;
  cursorMode: CursorMode;
};

/**
 * Parameters that change *how a request behaves* without changing the rows:
 * injected latency and injected failures. `feed-client.ts` reads them at
 * request time instead of taking them as arguments, so a variant is free to
 * leave them out of whatever identity it gives the list — several experiments
 * need them changed while pages are already loaded ("now make page 3 fail, and
 * now refetch").
 */
export type TransportKnobs = {
  latencyMs: number;
  failAt: number | null;
};

export type LabSettings = FeedParams &
  TransportKnobs & {
    /** Load the next page when the end of the list scrolls into view. */
    autoLoad: boolean;
    /** Unmount the list subtree without leaving the page. */
    listMounted: boolean;
  };

export const DEFAULT_SETTINGS: LabSettings = {
  limit: 20,
  sort: "newest",
  cursorMode: "keyset",
  // Slow enough that a five-page sequential refetch is unmistakable, fast
  // enough that the lab stays usable.
  latencyMs: 300,
  failAt: null,
  autoLoad: false,
  listMounted: true,
};

export function feedParamsOf(settings: LabSettings): FeedParams {
  return {
    limit: settings.limit,
    sort: settings.sort,
    cursorMode: settings.cursorMode,
  };
}
