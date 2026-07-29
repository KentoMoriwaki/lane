"use client";

import { useSyncExternalStore } from "react";
import type { CursorResolution } from "@/server/feed/schema";

/**
 * The lab's request log: an external store, written by the instrumented fetch
 * wrapper in `feed-client.ts` and read by the timeline.
 *
 * It lives at the fetch layer rather than inside a library's hooks so that the
 * numbers are the same numbers for every variant — nothing here knows what a
 * query, an observer or a lane is. A request is recorded the moment it is
 * *started*, not when it settles, because the whole question the lab asks is
 * "did these overlap?", and that can only be answered from start timestamps.
 *
 * Timestamps come from `performance.now()` (monotonic, sub-millisecond) and are
 * stored raw; the timeline converts them to positions relative to whatever
 * window it is drawing.
 */

export type RequestOutcome = "pending" | "ok" | "error" | "aborted";
export type RequestKind = "page" | "mutation";

export type RequestLogEntry = {
  id: number;
  kind: RequestKind;
  /** Short human label, e.g. `page @start` or `prepend`. */
  label: string;
  method: string;
  url: string;
  cursor: string | null;
  cursorLabel: string;
  /** `performance.now()` at the moment `fetch()` was called. */
  startedAt: number;
  /** Wall-clock start, for the human-readable timestamp column. */
  wallClock: number;
  endedAt: number | null;
  durationMs: number | null;
  status: number | null;
  outcome: RequestOutcome;
  /** Server-derived, 1-based. Present on page responses (and on injected failures). */
  pageIndex: number | null;
  /** Server-side monotonic sequence number — proves the order the server saw. */
  seq: number | null;
  itemCount: number | null;
  cursorResolution: CursorResolution | null;
  nextCursorLabel: string | null;
  message: string | null;
};

type Listener = () => void;

const EMPTY: readonly RequestLogEntry[] = [];

let entries: readonly RequestLogEntry[] = EMPTY;
let nextId = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export type BeginRequestInit = Pick<
  RequestLogEntry,
  "kind" | "label" | "method" | "url" | "cursor" | "cursorLabel"
>;

export function beginRequest(init: BeginRequestInit): number {
  const id = ++nextId;

  entries = [
    ...entries,
    {
      ...init,
      id,
      startedAt: now(),
      wallClock: Date.now(),
      endedAt: null,
      durationMs: null,
      status: null,
      outcome: "pending",
      pageIndex: null,
      seq: null,
      itemCount: null,
      cursorResolution: null,
      nextCursorLabel: null,
      message: null,
    },
  ];

  emit();
  return id;
}

export type SettleRequestPatch = Partial<
  Pick<
    RequestLogEntry,
    | "status"
    | "outcome"
    | "pageIndex"
    | "seq"
    | "itemCount"
    | "cursorResolution"
    | "nextCursorLabel"
    | "message"
  >
>;

/**
 * Close out an entry. Only the first settle wins, so an error path that both
 * records the HTTP failure and rethrows cannot overwrite its own reason.
 */
export function settleRequest(id: number, patch: SettleRequestPatch): void {
  const timestamp = now();
  let changed = false;

  entries = entries.map((entry) => {
    if (entry.id !== id || entry.outcome !== "pending") {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      ...patch,
      endedAt: timestamp,
      durationMs: timestamp - entry.startedAt,
    };
  });

  if (changed) {
    emit();
  }
}

export function clearRequestLog(): void {
  entries = EMPTY;
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly RequestLogEntry[] {
  return entries;
}

function getServerSnapshot(): readonly RequestLogEntry[] {
  return EMPTY;
}

export function useRequestLog(): readonly RequestLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
