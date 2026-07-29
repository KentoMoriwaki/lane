"use client";

import { useSyncExternalStore } from "react";

/**
 * The lab's request log: an external store, written by the instrumented fetch in
 * `search-client.ts` and read by the timeline.
 *
 * It sits at the fetch layer rather than inside the hook, so what it reports is
 * what the *network* did — nothing here knows what a lane or an entry is. That
 * separation is the entire point of this lab: a cancel is only worth anything if
 * the request actually stops, and the only place that can be observed is here.
 *
 * A request is recorded the moment it is started rather than when it settles,
 * because the question being asked is "did these overlap?", which can only be
 * answered from start timestamps.
 */

export type RequestOutcome = "pending" | "ok" | "aborted" | "error";

export type RequestLogEntry = {
  id: number;
  /** The query this request was made for — the varying part of the lane key. */
  q: string;
  url: string;
  /** `performance.now()` at the moment `fetch()` was called. */
  startedAt: number;
  /** Wall-clock start, for the human-readable timestamp column. */
  wallClock: number;
  endedAt: number | null;
  durationMs: number | null;
  status: number | null;
  outcome: RequestOutcome;
  /** Server-side monotonic sequence number — the order the server saw. */
  seq: number | null;
  rowCount: number | null;
  /** Whether the loader forwarded its signal on this request. */
  signalForwarded: boolean;
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
  "q" | "url" | "signalForwarded"
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
      seq: null,
      rowCount: null,
      message: null,
    },
  ];

  emit();
  return id;
}

export type SettleRequestPatch = Partial<
  Pick<RequestLogEntry, "status" | "outcome" | "seq" | "rowCount" | "message">
>;

/** Close out an entry. Only the first settle wins. */
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
