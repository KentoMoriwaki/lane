"use client";

import {
  Suspense,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FrameStrip,
  useFrameRecorder,
  type FrameFlag,
  type FrameRecorder,
} from "@/lab/frame-recorder";
import { labLog } from "@/lab/log";
import { LabActivity } from "@/lab/shells";
import { Timeline } from "@/lab/timeline";

// The question under test: at Activity reveal, do the re-appearing layout
// effects run BEFORE the browser paints the revealed (stale) content? If yes,
// a setPromise() from a layout-effect staleness check triggers a synchronous
// re-render — suspend, fallback — that replaces the stale content within the
// same task, and no stale pixel ever reaches the screen. That would make the
// layout check a token-free safety net for pattern B (no signal supply
// needed: the effect re-mount itself is the reveal evidence).
//
// Two lane-shaped readers of one store, differing in exactly one line:
//   baseline — subscription + staleness check in a passive effect only
//              (current lane behavior: converges after paint)
//   layout   — the same, plus the staleness check in useLayoutEffect
//
// Verdict comes from the FrameStrip: red = stale value sampled at a rAF tick
// (painted), amber = stale value seen only by the MutationObserver (committed
// but no paint boundary sampled it), absent = corrected within the reveal
// task (invisible even to the observer).

type Tracked = Promise<string> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: string;
};

const labels = new WeakMap<Promise<string>, string>();

function settled(value: string): Tracked {
  const promise = Promise.resolve(value) as Tracked;
  promise.status = "fulfilled";
  promise.value = value;
  labels.set(promise, `${value} (settled)`);
  return promise;
}

function pendingValue(value: string, ms: number): Tracked {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  }) as Tracked;
  promise.status = "pending";
  setTimeout(() => {
    promise.status = "fulfilled";
    promise.value = value;
    resolve(value);
  }, ms);
  labels.set(promise, `${value} (pending ${ms}ms)`);
  return promise;
}

const RESOLVE_MS = 400;

function createMiniStore() {
  let generation = 1;
  let entry: Tracked | null = settled("v1");
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    /** Read-through: a removed entry is re-created on the next read. */
    read(): Tracked {
      if (entry === null) {
        generation += 1;
        entry = pendingValue(`v${generation}`, RESOLVE_MS);
        labLog.push("reveal-sync:store", "loader-call", `re-read -> v${generation}`);
      }
      return entry;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Swap in a pending refresh; the old promise is now stale. */
    invalidate(): string {
      const previous = entry?.value ?? "?";
      generation += 1;
      entry = pendingValue(`v${generation}`, RESOLVE_MS);
      notify();
      return previous;
    },
    /** Drop the entry entirely; the next read() recreates it. */
    remove(): string {
      const previous = entry?.value ?? "?";
      entry = null;
      notify();
      return previous;
    },
    reset(): void {
      generation = 1;
      entry = settled("v1");
      notify();
    },
    label(promise: Promise<string>): string {
      return labels.get(promise) ?? "?";
    },
  };
}

const store = createMiniStore();

function Fallback({ channel }: { channel: string }) {
  labLog.push(channel, "custom", "suspense-fallback render");

  return (
    <span className="font-mono text-sm font-bold text-orange-600">
      SUSPENDED
    </span>
  );
}

function Reader({
  channel,
  layoutCheck,
}: {
  channel: string;
  layoutCheck: boolean;
}) {
  const [promise, setPromise] = useState<Tracked>(() => store.read());
  const promiseRef = useRef(promise);
  promiseRef.current = promise;

  labLog.push(channel, "render", `holding ${store.label(promise)}`);

  // The mechanism under test. [channel] deps: runs at mount and at every
  // Activity reveal (reappear re-fires effects regardless of deps), not on
  // ordinary re-renders.
  useLayoutEffect(() => {
    if (!layoutCheck) {
      return;
    }
    const current = store.read();
    if (current !== promiseRef.current) {
      labLog.push(channel, "custom", "layout-check STALE -> setPromise");
      setPromise(current);
    } else {
      labLog.push(channel, "custom", "layout-check clean");
    }
  }, [channel, layoutCheck]);

  // Lane-shaped: subscription lives in a passive effect, with the usual
  // catch-up check on (re)mount.
  useEffect(() => {
    labLog.push(channel, "passive-mount");
    const check = (origin: string) => {
      const current = store.read();
      if (current !== promiseRef.current) {
        labLog.push(channel, "custom", `${origin} STALE -> setPromise`);
        setPromise(current);
      }
    };
    check("passive-check");
    const unsubscribe = store.subscribe(() => check("notify"));
    return () => {
      labLog.push(channel, "passive-cleanup");
      unsubscribe();
    };
  }, [channel]);

  const value = use(promise as Promise<string>);

  return (
    <span className="font-mono text-sm font-bold" data-probe-value={channel}>
      {value}
    </span>
  );
}

// The flag is a stable function reading module state, because
// useFrameRecorder re-applies options.flag on every render — a captured
// string would be wiped by the next hidden re-render. armFlag() just swaps
// the value this closure reads.
let armedStale: string | null = null;
const staleFlag: FrameFlag = ({ text, display }) =>
  armedStale !== null && display !== "none" && text.includes(armedStale);

// The recorder and strip live OUTSIDE the Activity: a recorder inside the
// hidden subtree has its attach effect destroyed on hide and misses the
// reveal window entirely. Only the ref target (the Activity's host child,
// which receives the inline display:none) is inside. The content element is
// memoized so a reveal does not re-render the reader — matching the real
// bfcache condition where unchanged components bail out and only effects
// re-appear.
function ReaderPanel({
  title,
  channel,
  layoutCheck,
  hidden,
}: {
  title: string;
  channel: string;
  layoutCheck: boolean;
  hidden: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const recorder = useFrameRecorder(areaRef, { flag: staleFlag });

  recorders.set(channel, recorder);

  const content = useMemo(
    () => (
      <div ref={areaRef} className="rounded bg-zinc-50 p-2">
        <Suspense fallback={<Fallback channel={channel} />}>
          <Reader channel={channel} layoutCheck={layoutCheck} />
        </Suspense>
      </div>
    ),
    [channel, layoutCheck],
  );

  return (
    <div className="space-y-2 rounded border border-zinc-200 bg-white p-2">
      <div className="text-xs font-semibold text-zinc-600">{title}</div>
      <LabActivity
        mode={hidden ? "hidden" : "visible"}
        channel={`${channel}:activity`}
      >
        {content}
      </LabActivity>
      <FrameStrip
        recorder={recorder}
        label={`${channel} (red = stale painted, amber = committed only)`}
      />
    </div>
  );
}

const recorders = new Map<string, FrameRecorder>();

export default function RevealSyncPage() {
  const [hidden, setHidden] = useState(false);
  const [revealInTransition, setRevealInTransition] = useState(false);
  // Control experiment: with the layout check off, does the passive check
  // alone still beat paint (its flush timing is not sequenced against paint),
  // or does the stale value reach the screen? Toggling remounts the readers
  // (the memo key changes) — flip it before running a scenario.
  const [layoutEnabled, setLayoutEnabled] = useState(true);

  // The "end" marker closes the click task in the log: anything logged before
  // it ran in the same synchronous task as the commit — and a browser never
  // paints in the middle of a task, so same-task means paint-proof.
  const op = (name: string, run: () => void) => {
    labLog.push("reveal-sync:op", "lane-op", name);
    run();
    labLog.push("reveal-sync:op", "lane-op", `${name} end-of-task`);
  };

  const setMode = (nextHidden: boolean) => {
    const apply = () => setHidden(nextHidden);
    op(
      `${nextHidden ? "hide" : "reveal"}${revealInTransition ? " (transition)" : " (sync)"}`,
      () => {
        if (revealInTransition) {
          startTransition(apply);
        } else {
          apply();
        }
      },
    );
  };

  const armFlag = (staleValue: string) => {
    armedStale = staleValue;
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">
          /reveal-sync — layout-effect check vs the reveal paint
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          hide → invalidate (or remove) → reveal. Both readers hold the stale
          promise in state with a dead subscription. The layout reader also
          compares against the store in <code>useLayoutEffect</code>. If the
          re-appearing layout effect runs before paint, its strip shows no red
          stale frame — only the baseline&apos;s does.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-white p-3 text-sm">
        <button
          type="button"
          onClick={() => setMode(!hidden)}
          className="rounded border border-zinc-400 bg-white px-3 py-1 font-semibold hover:bg-zinc-100"
        >
          {hidden ? "reveal" : "hide"}
        </button>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={revealInTransition}
            onChange={(event) => setRevealInTransition(event.target.checked)}
          />
          toggle in transition
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={layoutEnabled}
            onChange={(event) => setLayoutEnabled(event.target.checked)}
          />
          layout check enabled
        </label>
        <button
          type="button"
          onClick={() => op("invalidate", () => armFlag(store.invalidate()))}
          className="rounded border border-zinc-400 bg-white px-3 py-1 font-semibold hover:bg-zinc-100"
        >
          invalidate
        </button>
        <button
          type="button"
          onClick={() => op("remove", () => armFlag(store.remove()))}
          className="rounded border border-rose-400 bg-white px-3 py-1 font-semibold text-rose-700 hover:bg-rose-50"
        >
          remove
        </button>
        <button
          type="button"
          onClick={() =>
            op("reset", () => {
              store.reset();
              armedStale = null;
              for (const recorder of recorders.values()) {
                recorder.clear();
              }
              labLog.clear();
            })
          }
          className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-100"
        >
          reset all
        </button>
        <span className="text-xs text-zinc-500">
          state: {hidden ? "hidden" : "visible"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ReaderPanel
          title="baseline — passive check only (lane-shaped)"
          channel="reveal-sync:base"
          layoutCheck={false}
          hidden={hidden}
        />
        <ReaderPanel
          title="layout — passive + useLayoutEffect check"
          channel="reveal-sync:layout"
          layoutCheck={layoutEnabled}
          hidden={hidden}
        />
      </div>

      <Timeline channels={["reveal-sync"]} />
    </main>
  );
}
