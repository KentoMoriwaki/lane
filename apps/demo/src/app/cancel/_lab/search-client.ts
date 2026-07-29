"use client";

import type { SearchResponse, SearchStats } from "@/server/search/schema";
import { beginRequest, settleRequest } from "./request-log";

/**
 * The lab's HTTP layer. Every read goes through `labSearch`, which records the
 * request before it leaves and settles the entry when it lands.
 *
 * The knobs are module state read at request time rather than parameters
 * threaded through the read. That is deliberate: the query is the identity of
 * the read, so anything routed through it would start a *different* read when
 * changed — and both knobs have to be adjustable while a read is already in
 * flight, which is the only interesting moment in this lab.
 */

const SEARCH_BASE = "/api/search";

type TransportKnobs = {
  latencyMs: number;
  forwardSignal: boolean;
};

let transport: TransportKnobs = { latencyMs: 1200, forwardSignal: true };

export function setTransportKnobs(next: TransportKnobs): void {
  transport = next;
}

/**
 * A search request, instrumented.
 *
 * When `forwardSignal` is off the signal is accepted and then dropped, which is
 * the whole experiment for that toggle: the request runs to completion and the
 * log says `ok`, so whatever the page shows afterwards is the library's doing
 * rather than the network's.
 */
export async function labSearch(
  q: string,
  signal: AbortSignal | undefined,
): Promise<SearchResponse> {
  const url = `${SEARCH_BASE}/rows?q=${encodeURIComponent(q)}&latency=${transport.latencyMs}`;
  const forwarded = transport.forwardSignal && signal !== undefined;
  const id = beginRequest({ q, signalForwarded: forwarded, url });

  let response: Response;

  try {
    response = await fetch(url, forwarded ? { signal } : undefined);
  } catch (error) {
    const aborted = signal?.aborted === true;

    settleRequest(id, {
      message: aborted
        ? "aborted before the response arrived"
        : error instanceof Error
          ? error.message
          : String(error),
      outcome: aborted ? "aborted" : "error",
    });

    throw error;
  }

  if (!response.ok) {
    settleRequest(id, {
      message: `HTTP ${response.status}`,
      outcome: "error",
      status: response.status,
    });

    throw new Error(`Search failed with ${response.status}`);
  }

  const body = (await response.json()) as SearchResponse;

  settleRequest(id, {
    outcome: "ok",
    rowCount: body.total,
    seq: body.seq,
    status: response.status,
  });

  return body;
}

/**
 * What the server counted, which is not what the client counted. A cancelled
 * request only saves the server work if the server was listening.
 */
export async function fetchSearchStats(): Promise<SearchStats> {
  const response = await fetch(`${SEARCH_BASE}/stats`, { cache: "no-store" });

  return (await response.json()) as SearchStats;
}

export async function resetSearchStats(): Promise<SearchStats> {
  const response = await fetch(`${SEARCH_BASE}/stats`, { method: "DELETE" });

  return (await response.json()) as SearchStats;
}
