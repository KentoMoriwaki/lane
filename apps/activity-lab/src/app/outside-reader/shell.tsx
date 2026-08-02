"use client";

import Link from "next/link";
import {
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LaneProvider } from "use-lane";
import { FrameStrip, useFrameRecorder } from "@/lab/frame-recorder";
import { labLog } from "@/lab/log";
import { Timeline } from "@/lab/timeline";
import { OutsideReader, StoreProbe } from "./outside-reader";
import {
  EMPTY_READER_STATE,
  readerState,
  type OutsideReaderState,
} from "./reader-state";
import { SyntheticPanel } from "./synthetic";
import {
  applyMemoryPressure,
  clearTracked,
  readTracked,
  type TrackedValue,
} from "./weak-probe";

const ROUTES = [
  { href: "/outside-reader", label: "index (no publish)" },
  { href: "/outside-reader/alpha", label: "alpha (publishes)" },
  { href: "/outside-reader/beta", label: "beta (publishes)" },
  { href: "/outside-reader/quiet", label: "quiet (no publish)" },
  { href: "/outside-reader/gamma", label: "gamma (publishes)" },
] as const;

function ms(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}ms`;
}

// Every HUD panel subscribes for itself. Subscribing in `OutsideShell` would
// re-render the shell — and with it the reader, whose render writes to this very
// store: one publication would amplify into an unbounded render loop at rAF
// rate, exactly the amplification `labLog` documents. (`OutsideReader` is
// memoized on top of that, so nothing else in the shell can drive it either.)
function useReaderState(): OutsideReaderState {
  return useSyncExternalStore(
    readerState.subscribe,
    readerState.snapshot,
    () => EMPTY_READER_STATE,
  );
}

function ReaderHud() {
  const state = useReaderState();
  const open = state.fallbacks.filter((window) => window.ms === null).length;
  const closed = state.fallbacks.filter((window) => window.ms !== null);

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-4">
      <div>
        <dt className="text-zinc-500">value</dt>
        <dd className="font-bold">{state.value ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-zinc-500">last render @</dt>
        <dd>{ms(state.lastRenderAt)}</dd>
      </div>
      <div>
        <dt className="text-zinc-500">last commit @</dt>
        <dd>{ms(state.lastCommitAt)}</dd>
      </div>
      <div>
        <dt className="text-zinc-500">renders / commits</dt>
        <dd>
          {state.renderCount} / {state.commitCount}
        </dd>
      </div>
      <div className="col-span-2">
        <dt className="text-zinc-500">fallback windows</dt>
        <dd data-fallbacks="">
          {state.fallbacks.length === 0
            ? "none"
            : `${state.fallbacks.length} (open: ${open}) ${closed
                .map((window) => `${window.ms!.toFixed(1)}ms`)
                .join(", ")}`}
        </dd>
      </div>
      <div>
        <dt className="text-zinc-500">pending</dt>
        <dd>
          bg:{state.bg ? 1 : 0} tr:{state.tr ? 1 : 0}
        </dd>
      </div>
      <div>
        <dt className="text-zinc-500">error</dt>
        <dd className={state.error ? "text-red-700" : ""} data-reader-error="">
          {state.error ? `${state.error.name} (${state.error.key ?? "?"})` : "—"}
        </dd>
      </div>
    </dl>
  );
}

function StoreHud() {
  const probe = useReaderState().probe;

  return (
    <div className="space-y-1">
      <StoreProbe />
      <div className="font-mono text-xs" data-store-probe="">
        {probe === null
          ? "store probe: not run"
          : `store probe #${probe.id}: ${
              probe.error
                ? `ERROR ${probe.error}`
                : probe.resolvedMs === null
                  ? `pending${probe.fallbackAt === null ? "" : " (fallback committed)"}`
                  : `${probe.fallbackAt === null ? "HIT (no fallback)" : "WAIT (fallback committed)"} value=${probe.value} after ${probe.resolvedMs.toFixed(1)}ms`
            }`}
      </div>
    </div>
  );
}

function WeakRefHud() {
  const [tracked, setTracked] = useState<readonly TrackedValue[]>([]);
  const [pressure, setPressure] = useState<string>("—");

  useEffect(() => {
    const poll = () => setTracked(readTracked());
    poll();
    const timer = setInterval(poll, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPressure("running…");
            void applyMemoryPressure().then((took) =>
              setPressure(`${took.toFixed(0)}ms`),
            );
          }}
          className="rounded border border-violet-400 bg-white px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          GC pressure
        </button>
        <button
          type="button"
          onClick={() => {
            clearTracked();
            setTracked([]);
          }}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100"
        >
          clear tracked
        </button>
        <span className="font-mono text-xs text-zinc-500">pressure: {pressure}</span>
      </div>
      <ol className="font-mono text-xs" data-weakrefs="">
        {tracked.length === 0 ? (
          <li className="text-zinc-400">nothing tracked</li>
        ) : (
          tracked.map((entry) => (
            <li key={`${entry.label}#${entry.n}`}>
              <span className="text-zinc-500">
                {entry.label}#{entry.n}
              </span>{" "}
              <span
                className={
                  entry.collectedAt === null
                    ? "font-bold text-emerald-700"
                    : "font-bold text-red-700"
                }
              >
                {entry.collectedAt === null ? "ALIVE" : "COLLECTED"}
              </span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

const MemoOutsideReader = memo(OutsideReader);

export function OutsideShell({ children }: { children: ReactNode }) {
  const readerAreaRef = useRef<HTMLDivElement>(null);
  const recorder = useFrameRecorder(readerAreaRef, {
    flag: "SUSPENDED (outside reader)",
  });

  return (
    // No `lane` prop on purpose: the provider builds one per instance, so the
    // server gets a fresh store per request (a module-scoped lane would carry
    // one request's publications into the next request's SSR and make every
    // streaming measurement a lie) and the client gets one per document, which
    // the persistent layout keeps across every soft navigation.
    <LaneProvider>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">/outside-reader</span>
          {ROUTES.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className="rounded border border-zinc-300 bg-white px-2 py-1 font-mono hover:bg-zinc-100"
            >
              {route.label}
            </Link>
          ))}
        </nav>

        <div
          ref={readerAreaRef}
          className="space-y-2 rounded-lg border-2 border-emerald-400 bg-white p-3"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            layout-level reader — outside every &lt;LaneHydration&gt; boundary,
            own Suspense
          </div>
          <MemoOutsideReader />
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-300 bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            HUD
          </div>
          <ReaderHud />
          <hr className="border-zinc-200" />
          <StoreHud />
          <hr className="border-zinc-200" />
          <WeakRefHud />
          <hr className="border-zinc-200" />
          <SyntheticPanel />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                readerState.reset();
                labLog.clear();
              }}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100"
            >
              reset HUD + timeline
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-3">
          {children}
        </div>

        <FrameStrip
          recorder={recorder}
          label="outside reader area (red = fallback in DOM)"
        />
        <Timeline channels={["outside"]} />
      </div>
    </LaneProvider>
  );
}
