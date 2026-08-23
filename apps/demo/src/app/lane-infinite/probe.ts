"use client";

/**
 * The measurement rig for the spike.
 *
 * Every page the infinite loader produces is recorded here with *how* it was
 * obtained — resolved from the prop the route handed over, or fetched over the
 * wire — and with the identity of the response it came from. Three of the
 * spike's claims are only answerable from this log:
 *
 * - "page 1 costs zero client fetches" is `network` events with `cursor: null`
 *   staying at zero, forever;
 * - "a changed page 1 resets the list and costs nothing" is a lone `adopt`
 *   event under a new `version`, with no `network` events beside it;
 * - "an unchanged page 1 keeps the depth" is *no events at all* after a
 *   republication.
 *
 * A module-level store read through `useSyncExternalStore`: the loader that
 * records is not inside a render, and the log has to survive the transitions
 * that hold the list on screen.
 */

export type ProbeEvent = {
  id: number;
  /** `adopt` — page 1, taken from the prop. `network` — an HTTP fetch. */
  kind: "adopt" | "network";
  /** The user action in flight when the loader ran. */
  phase: string;
  cursor: string | null;
  /** The content identity of the page this event produced. */
  version: string | null;
  /** Which server response it came from — provenance, not content. */
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
 * Labels the log lines that follow with the action that caused them. Sticky
 * until the next action sets it — the loader has no way to ask, and every path
 * that runs it here is reached from a click.
 */
export function setProbePhase(next: string) {
  phase = next;
}

export function recordProbe(
  kind: ProbeEvent["kind"],
  cursor: string | null,
  page: { serveSeq: number; servedAt: string; version: string },
) {
  events = [
    ...events,
    {
      at: Date.now(),
      cursor,
      id: (nextId += 1),
      kind,
      phase,
      servedAt: page.servedAt,
      serveSeq: page.serveSeq,
      version: page.version,
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

/**
 * Interim promises, by instance.
 *
 * The hook's interim wrapper is created during a render that *always* suspends
 * (one microtask on the derived promise), so there is always a retry — and the
 * whole reason it lives in a `WeakMap` keyed on the route's promise rather than
 * in a `useMemo` is that the retry must get the identical object back. This is
 * how that is checked: each distinct instance is given a number, and a
 * republication that produced more than one number means the cache failed.
 */
const interimIds = new WeakMap<Promise<unknown>, number>();
let interimCount = 0;
let interimLog: number[] = [];

export function recordInterim(promise: Promise<unknown>) {
  let id = interimIds.get(promise);

  if (id === undefined) {
    id = (interimCount += 1);
    interimIds.set(promise, id);
  }

  interimLog = [...interimLog, id];

  if (typeof window !== "undefined") {
    (
      window as unknown as { __laneInfiniteInterim?: unknown }
    ).__laneInfiniteInterim = {
      distinct: interimCount,
      log: interimLog,
    };
  }
}

export function resetProbe() {
  events = [];
  nextId = 0;
  interimLog = [];
  emit();

  if (typeof window !== "undefined") {
    (
      window as unknown as { __laneInfiniteInterim?: unknown }
    ).__laneInfiniteInterim = { distinct: interimCount, log: interimLog };
  }
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
