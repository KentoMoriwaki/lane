export type LabEventKind =
  | "render"
  | "layout-mount"
  | "layout-cleanup"
  | "passive-mount"
  | "passive-cleanup"
  | "loader-call"
  | "loader-settle"
  | "lane-op"
  | "activity"
  | "custom";

export type LabEvent = {
  t: number;
  channel: string;
  kind: LabEventKind;
  detail?: string;
};

type Listener = () => void;

const events: LabEvent[] = [];
const listeners = new Set<Listener>();

let snapshotCache: readonly LabEvent[] = [];
let notifyScheduled = false;

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

// Probes push from the render phase, so notifying cannot be synchronous. It
// cannot be a microtask either: the Timeline's useSyncExternalStore update is
// a sync-priority render, and a microtask lands it inside React's low-priority
// re-render of a hidden Activity subtree — which React then restarts, logging
// another render event, scheduling another notify. A hide burst amplifies to
// hundreds of probe renders that exist only because the log was watching.
// Coalescing to one notification per animation frame leaves offscreen work an
// idle window to complete in.
function scheduleNotify() {
  if (notifyScheduled) {
    return;
  }

  notifyScheduled = true;
  let done = false;
  const flush = () => {
    if (done) {
      return;
    }
    done = true;
    notifyScheduled = false;
    snapshotCache = events.slice();
    for (const listener of listeners) {
      listener();
    }
  };
  // rAF stalls entirely in unpainted/backgrounded tabs, so a timeout races it
  // as a backstop; the coalescing window it provides is what matters, not the
  // frame alignment.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flush());
  }
  setTimeout(flush, 60);
}

export const labLog = {
  push(channel: string, kind: LabEventKind, detail?: string): void {
    events.push({ t: now(), channel, kind, detail });
    scheduleNotify();
  },

  clear(): void {
    events.length = 0;
    scheduleNotify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  snapshot(): readonly LabEvent[] {
    return snapshotCache;
  },
};
