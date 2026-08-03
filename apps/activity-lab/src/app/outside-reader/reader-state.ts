/**
 * What the HUD shows about the layout-level reader.
 *
 * The reader lives in its own Suspense boundary, a sibling of the HUD, so
 * nothing it observes can be lifted into shared React state without making the
 * HUD its parent (and its re-renders the reader's). A tiny external store keeps
 * them independent — and, like `labLog`, coalesces notification to one per frame
 * because the writes happen in the render phase.
 */

export type FallbackWindow = { at: number; ms: number | null };

export type ProbeResult = {
  /** Which mount of the on-demand store probe this is. */
  id: number;
  at: number;
  /** Set when the probe's own Suspense fallback committed. */
  fallbackAt: number | null;
  /** When the probe's reader committed a value, relative to its mount. */
  resolvedMs: number | null;
  value: string | null;
  error: string | null;
};

export type OutsideReaderState = {
  value: string | null;
  n: number | null;
  /** `performance.now()` of the last render that produced a value. */
  lastRenderAt: number | null;
  /** `performance.now()` of the last layout-effect commit. */
  lastCommitAt: number | null;
  renderCount: number;
  commitCount: number;
  bg: boolean;
  tr: boolean;
  /** Every committed fallback window, newest last. `ms: null` = still open. */
  fallbacks: FallbackWindow[];
  error: { name: string; message: string; key: string | null; at: number } | null;
  probe: ProbeResult | null;
};

const state: OutsideReaderState = {
  bg: false,
  commitCount: 0,
  error: null,
  fallbacks: [],
  lastCommitAt: null,
  lastRenderAt: null,
  n: null,
  probe: null,
  renderCount: 0,
  tr: false,
  value: null,
};

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: OutsideReaderState = { ...state };
let scheduled = false;

function notify(): void {
  if (scheduled) {
    return;
  }

  scheduled = true;
  let done = false;
  const flush = () => {
    if (done) {
      return;
    }
    done = true;
    scheduled = false;
    snapshot = { ...state, fallbacks: state.fallbacks.slice() };
    for (const listener of listeners) {
      listener();
    }
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flush());
  }
  setTimeout(flush, 60);
}

export const readerState = {
  observeRender(value: string, n: number, at: number, bg: boolean, tr: boolean): void {
    state.value = value;
    state.n = n;
    state.lastRenderAt = at;
    state.renderCount += 1;
    state.bg = bg;
    state.tr = tr;
    state.error = null;
    notify();
  },

  observeCommit(at: number): void {
    state.lastCommitAt = at;
    state.commitCount += 1;
    notify();
  },

  openFallback(at: number): void {
    state.fallbacks.push({ at, ms: null });
    notify();
  },

  closeFallback(at: number): void {
    const open = state.fallbacks.at(-1);

    if (open && open.ms === null) {
      open.ms = at - open.at;
    }

    notify();
  },

  observeError(error: unknown, at: number): void {
    const named = error as { name?: string; message?: string; keyId?: string };
    state.error = {
      at,
      key: named?.keyId ?? null,
      message: named?.message ?? String(error),
      name: named?.name ?? "Error",
    };
    notify();
  },

  startProbe(id: number, at: number): void {
    state.probe = {
      at,
      error: null,
      fallbackAt: null,
      id,
      resolvedMs: null,
      value: null,
    };
    notify();
  },

  probeFallback(id: number, at: number): void {
    if (state.probe?.id === id && state.probe.fallbackAt === null) {
      state.probe.fallbackAt = at;
      notify();
    }
  },

  probeResolved(id: number, at: number, value: string): void {
    if (state.probe?.id === id) {
      state.probe.resolvedMs = at - state.probe.at;
      state.probe.value = value;
      notify();
    }
  },

  probeError(id: number, at: number, error: unknown): void {
    if (state.probe?.id === id) {
      const named = error as { name?: string; message?: string };
      state.probe.resolvedMs = at - state.probe.at;
      state.probe.error = `${named?.name ?? "Error"}: ${named?.message ?? String(error)}`;
      notify();
    }
  },

  reset(): void {
    state.fallbacks.length = 0;
    state.renderCount = 0;
    state.commitCount = 0;
    state.error = null;
    state.probe = null;
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  snapshot(): OutsideReaderState {
    return snapshot;
  },
};

export const EMPTY_READER_STATE: OutsideReaderState = { ...state, fallbacks: [] };
