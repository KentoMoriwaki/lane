"use client";

import {
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import {
  LaneHydration,
  LaneProvider,
  type LaneHydrationSnapshots,
  type LaneReadSpec,
  type LaneUseOptions,
} from "use-lane";
import {
  AgitatorTickProvider,
  TickConsumer,
  useAgitatorTick,
  type AgitatorKind,
} from "@/lab/agitator";
import { FrameStrip, useFrameRecorder } from "@/lab/frame-recorder";
import type { LabLoader } from "@/lab/loader";
import { labLog } from "@/lab/log";
import { MemoProbe, Probe, ProbeAll } from "@/lab/probe";
import { LabActivity, useLabVisibility } from "@/lab/shells";
import {
  agitateQuadrant,
  KEY_A,
  KEY_B,
  type QuadrantRuntime,
} from "./runtime";

export type ReaderOpts = Pick<
  LaneUseOptions,
  "refetchOnMount" | "whenStale" | "staleTime"
>;

const AGITATIONS: readonly AgitatorKind[] = [
  "urgent",
  "flushSync",
  "transition",
  "contextTick",
];

const EMPTY: readonly never[] = [];

function LoaderStats({ loader }: { loader: LabLoader }) {
  useSyncExternalStore(labLog.subscribe, labLog.snapshot, () => EMPTY);

  return (
    <span className="font-mono text-[10px] text-zinc-500">
      calls={loader.calls} pending={loader.pending} {loader.mode}/{loader.delay}
      ms
    </span>
  );
}

function HydrationPending({ channel }: { channel: string }) {
  labLog.push(channel, "custom", "hydration-fallback render");

  return (
    <div className="rounded border-2 border-dashed border-cyan-500 bg-cyan-50 px-2 py-1 font-mono text-xs font-bold text-cyan-700">
      HYDRATING
    </div>
  );
}

// Owns the probe elements so an urgent/flushSync/transition bump re-renders
// them — see `QuadrantRuntime.localBump` for why the kit's RenderAgitator
// cannot deliver that render to a child passed as `children`.
function AgitatedZone({
  runtime,
  read,
}: {
  runtime: QuadrantRuntime;
  read: LaneReadSpec<string>;
}) {
  const [tick, setTick] = useState(0);

  labLog.push(`matrix:${runtime.id}:zone`, "render", `tick=${tick}`);

  useEffect(() => {
    const bump = () => setTick((current) => current + 1);
    runtime.localBump = (kind) => {
      if (kind === "flushSync") {
        flushSync(bump);
      } else if (kind === "transition") {
        startTransition(bump);
      } else {
        bump();
      }
    };
    return () => {
      runtime.localBump = null;
    };
  }, [runtime]);

  return (
    <>
      <Probe
        channel={`matrix:${runtime.id}:a1`}
        read={read}
        label={`A #1 (agitated, zone tick=${tick})`}
      />
      <MemoProbe
        channel={`matrix:${runtime.id}:a1-memo`}
        read={read}
        label="A #1m (memo, same zone)"
      />
    </>
  );
}

// Consumes the tick context itself — a context bump re-renders only
// consumers, and the probes do not read it, so without this component
// re-creating the probe elements on every tick, `contextTick` would never
// reach `useLane` inside a hidden subtree.
function QuadrantBody({
  runtime,
  readA,
  readB,
  readsAll,
}: {
  runtime: QuadrantRuntime;
  readA: LaneReadSpec<string>;
  readB: LaneReadSpec<string>;
  readsAll: readonly LaneReadSpec<string>[];
}) {
  const tick = useAgitatorTick();
  const visibility = useLabVisibility();

  labLog.push(
    `matrix:${runtime.id}:body`,
    "render",
    `tick=${tick} vis=${visibility}`,
  );

  return (
    <div className="space-y-1 p-1">
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <TickConsumer channel={`matrix:${runtime.id}:tick`} />
        <span>vis:{visibility}</span>
      </div>
      <AgitatedZone runtime={runtime} read={readA} />
      <Probe
        channel={`matrix:${runtime.id}:a2`}
        read={readA}
        label="A #2 (plain sibling)"
      />
      <Probe channel={`matrix:${runtime.id}:b`} read={readB} label="B" />
      <ProbeAll
        channel={`matrix:${runtime.id}:all`}
        reads={readsAll}
        label="A+B"
      />
    </div>
  );
}

export function Quadrant({
  runtime,
  mode,
  variant,
  readerOpts,
  snapshots,
}: {
  runtime: QuadrantRuntime;
  mode: "visible" | "hidden";
  variant: "opaque" | "instrumented";
  readerOpts: ReaderOpts;
  snapshots?: LaneHydrationSnapshots;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);

  const flag = useCallback(
    ({ text }: { text: string; display: string }) => {
      if (runtime.deadValues.size === 0) {
        return false;
      }
      for (const value of runtime.deadValues) {
        if (text.includes(value)) {
          return true;
        }
      }
      return false;
    },
    [runtime],
  );
  const recorder = useFrameRecorder(frameRef, { flag });

  useEffect(() => {
    runtime.recorder = recorder;
    return () => {
      if (runtime.recorder === recorder) {
        runtime.recorder = null;
      }
    };
  }, [runtime, recorder]);

  const readA = useMemo<LaneReadSpec<string>>(
    () => ({ key: KEY_A, loader: runtime.loader.loader, ...readerOpts }),
    [runtime, readerOpts],
  );
  const readB = useMemo<LaneReadSpec<string>>(
    () => ({ key: KEY_B, loader: runtime.loader.loader, ...readerOpts }),
    [runtime, readerOpts],
  );
  const readsAll = useMemo(() => [readA, readB], [readA, readB]);

  const body = (
    <QuadrantBody
      runtime={runtime}
      readA={readA}
      readB={readB}
      readsAll={readsAll}
    />
  );

  const seeded =
    runtime.hasHydration && snapshots !== undefined ? (
      <Suspense
        fallback={<HydrationPending channel={`matrix:${runtime.id}:hyd`} />}
      >
        <LaneHydration snapshots={snapshots}>{body}</LaneHydration>
      </Suspense>
    ) : (
      body
    );

  return (
    <section className="space-y-2 rounded-lg border border-zinc-300 bg-zinc-100 p-2">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="mr-1 rounded bg-zinc-800 px-1 font-mono text-[10px] text-white">
            {runtime.id}
          </span>
          {runtime.title}
        </h3>
        <LoaderStats loader={runtime.loader} />
      </header>

      <div className="flex flex-wrap items-center gap-1">
        {AGITATIONS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => agitateQuadrant(runtime, kind)}
            className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-50"
          >
            {kind}
          </button>
        ))}
        <button
          type="button"
          onClick={() => runtime.loader.resolveNext()}
          className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] hover:bg-amber-100"
        >
          resolve next
        </button>
      </div>

      <LaneProvider lane={runtime.lane}>
        {runtime.hasActivity && (
          <Probe
            channel={`matrix:${runtime.id}:outside`}
            read={readA}
            label="A outside (never hidden)"
          />
        )}
        <AgitatorTickProvider agitator={runtime.agitator}>
          {runtime.hasActivity ? (
            <div className="rounded border border-dashed border-zinc-400 p-1">
              <div className="px-1 text-[10px] uppercase tracking-wide text-zinc-500">
                LabActivity ({mode}, {variant})
              </div>
              <LabActivity
                mode={mode}
                variant={variant}
                channel={`matrix:${runtime.id}:activity`}
              >
                <div ref={frameRef}>{seeded}</div>
              </LabActivity>
            </div>
          ) : (
            <div ref={frameRef}>{seeded}</div>
          )}
        </AgitatorTickProvider>
      </LaneProvider>

      <FrameStrip recorder={recorder} label={`${runtime.id} frames`} />
    </section>
  );
}
