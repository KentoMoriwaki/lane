"use client";

/**
 * The measurement rig for the spike.
 *
 * Every page the infinite loader asks for is recorded here with *how* it was
 * obtained — adopted from the publication or fetched over the wire — and with
 * the `servedAt` / `serveSeq` stamp of the response it ended up holding. Two of
 * the spike's assumptions are only answerable from that log:
 *
 * - "page 1 costs zero client fetches" is `network` events with `cursor: null`
 *   being zero, forever.
 * - "a re-walk uses the latest closure" is the `adopt` event of the re-walk
 *   carrying the *new* `serveSeq`, not the one the entry was created with.
 *
 * A module-level store with `useSyncExternalStore` rather than component state:
 * the loader that records is not inside a render, and the log has to survive
 * the transitions that hold the list on screen.
 */

export type ProbeEvent = {
  id: number;
  /** `adopt` — page 1, taken from the publication. `network` — an HTTP fetch. */
  kind: "adopt" | "network";
  /** Why the loader ran: the first read, a re-walk, or a `loadMore` append. */
  phase: string;
  cursor: string | null;
  /** The `serveSeq` of the response this page came from. */
  serveSeq: number | null;
  servedAt: string | null;
  at: number;
};

let nextId = 0;
let events: ProbeEvent[] = [];
let phase = "mount";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Names what the loader is currently running for. Set by the component right
 * before it triggers a re-walk or an append, read by the loader that follows.
 * A ref would be per-component; this is per-lane-read and deliberately global,
 * because the point is to label a log line, not to drive UI.
 */
export function setProbePhase(next: string) {
  phase = next;
}

export function recordProbe(
  kind: ProbeEvent["kind"],
  cursor: string | null,
  page: { serveSeq: number; servedAt: string } | null,
) {
  events = [
    ...events,
    {
      at: Date.now(),
      cursor,
      id: (nextId += 1),
      kind,
      phase,
      servedAt: page?.servedAt ?? null,
      serveSeq: page?.serveSeq ?? null,
    },
  ];
  emit();

  if (typeof window !== "undefined") {
    (window as unknown as { __laneInfiniteProbe?: unknown }).__laneInfiniteProbe =
      {
        events,
        networkPageOneCount: events.filter(
          (event) => event.kind === "network" && event.cursor === null,
        ).length,
        networkTotal: events.filter((event) => event.kind === "network").length,
        reset: resetProbe,
      };
  }
}

export function resetProbe() {
  events = [];
  nextId = 0;
  emit();
}

export function subscribeProbe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProbeEvents(): ProbeEvent[] {
  return events;
}

const SERVER_EVENTS: ProbeEvent[] = [];

export function getProbeServerSnapshot(): ProbeEvent[] {
  return SERVER_EVENTS;
}
