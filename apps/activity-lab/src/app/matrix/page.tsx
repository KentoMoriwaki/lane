"use client";

import Link from "next/link";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { laneSnapshot, type LaneHydrationSnapshots } from "use-lane";
import type { AgitatorKind } from "@/lab/agitator";
import type { LabLoaderMode } from "@/lab/loader";
import { labLog } from "@/lab/log";
import { Timeline } from "@/lab/timeline";
import { Quadrant, type ReaderOpts } from "./quadrant";
import {
  agitateQuadrant,
  createRuntimes,
  KEY_A,
  KEY_B,
  keyOf,
  PROBE_SUFFIXES,
  type KeyId,
  type QuadrantId,
  type QuadrantRuntime,
} from "./runtime";
import {
  SCENARIOS,
  ScenarioAborted,
  type MatrixOps,
  type Scenario,
} from "./scenarios";

const QUADRANT_IDS: readonly QuadrantId[] = ["P", "A", "H", "AH"];

const AGITATIONS: readonly AgitatorKind[] = [
  "urgent",
  "flushSync",
  "transition",
  "contextTick",
];

function makeSnapshots(version: number): LaneHydrationSnapshots {
  return {
    entries: [
      laneSnapshot(KEY_A, `s${version}`),
      laneSnapshot(KEY_B, `s${version}`),
    ],
  };
}

const buttonClass =
  "rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-100";
const opButtonClass =
  "rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100";

export default function MatrixPage() {
  const [runtimes, setRuntimes] = useState<QuadrantRuntime[]>(createRuntimes);
  const runtimesRef = useRef(runtimes);
  runtimesRef.current = runtimes;

  const [epoch, setEpoch] = useState(0);
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  const [variant, setVariant] = useState<"opaque" | "instrumented">("opaque");
  const [selectedKey, setSelectedKey] = useState<KeyId>("a");
  const [readerOpts, setReaderOpts] = useState<ReaderOpts>({});
  const [loaderMode, setLoaderMode] = useState<LabLoaderMode>("auto");
  const [loaderDelay, setLoaderDelay] = useState(200);
  const loaderModeRef = useRef(loaderMode);
  const loaderDelayRef = useRef(loaderDelay);
  const [snapVersion, setSnapVersion] = useState(1);
  const snapshots = useMemo(() => makeSnapshots(snapVersion), [snapVersion]);

  const [channelFilter, setChannelFilter] = useState<readonly QuadrantId[]>([]);
  const [running, setRunning] = useState<Scenario | null>(null);
  const [stepLabel, setStepLabel] = useState("");
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const setSeqRef = useRef(0);

  // Client-island gate: rendering the scene through SSR runs
  // the loaders on the server, and selective hydration then defers the probes'
  // first client render until the first interaction — a confound measured in
  // WS1, not a hypothetical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ops = useMemo<MatrixOps>(() => {
    const each = (fn: (runtime: QuadrantRuntime) => void) => {
      for (const runtime of runtimesRef.current) {
        fn(runtime);
      }
    };

    const captureRemoved = (runtime: QuadrantRuntime, which: KeyId) => {
      if (typeof document === "undefined") {
        return;
      }
      for (const suffix of PROBE_SUFFIXES[which]) {
        const element = document.querySelector(
          `[data-probe-value="matrix:${runtime.id}:${suffix}"]`,
        );
        const text = element?.textContent?.trim();
        if (text !== undefined && text !== "") {
          runtime.deadValues.add(text);
        }
      }
    };

    return {
      mark(detail) {
        labLog.push("matrix:scenario", "custom", detail);
        setStepLabel(detail);
      },
      sleep(ms) {
        return new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            if (abortRef.current) {
              reject(new ScenarioAborted());
            } else {
              resolve();
            }
          }, ms);
        });
      },
      setMode(next) {
        labLog.push("matrix:op", "custom", `activity mode -> ${next}`);
        setMode(next);
      },
      remountScene(nextMode) {
        labLog.push("matrix:op", "custom", `remount scene (${nextMode})`);
        const next = createRuntimes(
          loaderModeRef.current,
          loaderDelayRef.current,
        );
        runtimesRef.current = next;
        setRuntimes(next);
        setMode(nextMode);
        setEpoch((current) => current + 1);
      },
      invalidate(which) {
        labLog.push(
          "matrix:op",
          "lane-op",
          `invalidate ${which.toUpperCase()} -> all`,
        );
        each((runtime) => runtime.lane.invalidate(keyOf(which)));
      },
      remove(which) {
        labLog.push(
          "matrix:op",
          "lane-op",
          `remove ${which.toUpperCase()} -> all`,
        );
        each((runtime) => {
          captureRemoved(runtime, which);
          runtime.lane.remove(keyOf(which));
        });
      },
      set(which) {
        setSeqRef.current += 1;
        const value = `set${setSeqRef.current}`;
        labLog.push(
          "matrix:op",
          "lane-op",
          `set ${which.toUpperCase()}=${value} -> all`,
        );
        each((runtime) => {
          void runtime.lane.set(keyOf(which), value);
        });
      },
      update(which) {
        labLog.push(
          "matrix:op",
          "lane-op",
          `update ${which.toUpperCase()} (v => v+"+u") -> all`,
        );
        each((runtime) => {
          void runtime.lane.update<string>(keyOf(which), (value) => `${value}+u`);
        });
      },
      republish() {
        labLog.push(
          "matrix:op",
          "lane-op",
          "snapshot republish (transition) -> H, AH",
        );
        startTransition(() => setSnapVersion((current) => current + 1));
      },
      agitate(kind) {
        each((runtime) => agitateQuadrant(runtime, kind));
      },
      resolveAll() {
        labLog.push("matrix:op", "custom", "resolve all pending");
        each((runtime) => {
          while (runtime.loader.pending > 0) {
            runtime.loader.resolveNext();
          }
        });
      },
      setLoaderMode(next) {
        loaderModeRef.current = next;
        setLoaderMode(next);
        each((runtime) => runtime.loader.setMode(next));
      },
      setLoaderDelay(ms) {
        loaderDelayRef.current = ms;
        setLoaderDelay(ms);
        each((runtime) => runtime.loader.setDelay(ms));
      },
      setReaderOpts(opts) {
        labLog.push("matrix:op", "custom", `reader opts ${JSON.stringify(opts)}`);
        setReaderOpts(opts);
      },
    };
  }, []);

  const runScenario = async (scenario: Scenario) => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    abortRef.current = false;
    setRunning(scenario);
    setStepLabel("");
    labLog.push(
      "matrix:scenario",
      "custom",
      `>>> #${scenario.id} ${scenario.title}`,
    );
    try {
      await scenario.run(ops);
      labLog.push("matrix:scenario", "custom", `<<< #${scenario.id} done`);
    } catch (error) {
      labLog.push(
        "matrix:scenario",
        "custom",
        error instanceof ScenarioAborted
          ? `<<< #${scenario.id} aborted`
          : `<<< #${scenario.id} error: ${String(error)}`,
      );
    } finally {
      runningRef.current = false;
      setRunning(null);
    }
  };

  const resetLab = () => {
    labLog.clear();
    for (const runtime of runtimesRef.current) {
      runtime.deadValues.clear();
      runtime.recorder?.clear();
    }
  };

  const timelineChannels = useMemo(
    () =>
      channelFilter.length === 0
        ? ["matrix", "loader:mx"]
        : [
            ...channelFilter.flatMap((id) => [
              `matrix:${id}`,
              `loader:mx:${id}`,
            ]),
            "matrix:op",
            "matrix:scenario",
          ],
    [channelFilter],
  );

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">/matrix</h1>
        <p className="text-sm text-zinc-600">
          Hydration × Activity の 2×2。象限ごとに独立 lane + 同一キー(A/B)+
          象限別 loader。操作は全象限へブロードキャスト。シナリオに期待値はない
          — 読み取りは Timeline / FrameStrip で。
        </p>
      </div>

      <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
        <h2 className="text-sm font-semibold">操作パネル(全象限共通)</h2>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              ops.setMode(mode === "visible" ? "hidden" : "visible")
            }
            className="rounded border border-zinc-400 bg-white px-3 py-1 text-sm font-semibold hover:bg-zinc-100"
          >
            {mode === "visible" ? "hide" : "reveal"}
          </button>
          <span className="font-mono text-xs text-zinc-500">mode={mode}</span>
          <label className="flex items-center gap-1 text-xs">
            shell
            <select
              value={variant}
              onChange={(event) =>
                setVariant(event.target.value as "opaque" | "instrumented")
              }
              className="rounded border border-zinc-300 px-1 py-0.5"
            >
              <option value="opaque">opaque</option>
              <option value="instrumented">instrumented</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => ops.remountScene("visible")}
            className={buttonClass}
          >
            remount visible
          </button>
          <button
            type="button"
            onClick={() => ops.remountScene("hidden")}
            className={buttonClass}
          >
            remount hidden
          </button>
          <button type="button" onClick={resetLab} className={buttonClass}>
            reset log + frames
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            key
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value as KeyId)}
              className="rounded border border-zinc-300 px-1 py-0.5"
            >
              <option value="a">A (mx/a)</option>
              <option value="b">B (mx/b)</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => ops.invalidate(selectedKey)}
            className={opButtonClass}
          >
            invalidate
          </button>
          <button
            type="button"
            onClick={() => ops.remove(selectedKey)}
            className={opButtonClass}
          >
            remove
          </button>
          <button
            type="button"
            onClick={() => ops.set(selectedKey)}
            className={opButtonClass}
          >
            set
          </button>
          <button
            type="button"
            onClick={() => ops.update(selectedKey)}
            className={opButtonClass}
          >
            update
          </button>
          <button
            type="button"
            onClick={() => ops.republish()}
            className={opButtonClass}
          >
            snapshot republish (v{snapVersion} → v{snapVersion + 1})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">agitate (all):</span>
          {AGITATIONS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => ops.agitate(kind)}
              className={buttonClass}
            >
              {kind}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            loader
            <select
              value={loaderMode}
              onChange={(event) =>
                ops.setLoaderMode(event.target.value as LabLoaderMode)
              }
              className="rounded border border-zinc-300 px-1 py-0.5"
            >
              <option value="auto">auto</option>
              <option value="manual">manual</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            delay
            <input
              type="number"
              min={0}
              step={100}
              value={loaderDelay}
              onChange={(event) =>
                ops.setLoaderDelay(Number(event.target.value) || 0)
              }
              className="w-16 rounded border border-zinc-300 px-1 py-0.5"
            />
            ms
          </label>
          <button
            type="button"
            onClick={() => ops.resolveAll()}
            className={buttonClass}
          >
            resolve all pending
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">reader opts:</span>
          <label className="flex items-center gap-1 text-xs">
            refetchOnMount
            <select
              value={String(readerOpts.refetchOnMount ?? "default")}
              onChange={(event) => {
                const raw = event.target.value;
                ops.setReaderOpts({
                  ...readerOpts,
                  // The "always" form was removed from the triggers upstream
                  // (main, "Drop the always form of the revalidation
                  // triggers"); staleTime: 0 expresses the same intent.
                  refetchOnMount: raw === "default" ? undefined : raw === "true",
                });
              }}
              className="rounded border border-zinc-300 px-1 py-0.5"
            >
              <option value="default">default</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            gcTime
            <select
              value={readerOpts.gcTime === undefined ? "default" : String(readerOpts.gcTime)}
              onChange={(event) => {
                const raw = event.target.value;
                ops.setReaderOpts({
                  ...readerOpts,
                  gcTime: raw === "default" ? undefined : Number(raw),
                });
              }}
              className="rounded border border-zinc-300 px-1 py-0.5"
            >
              <option value="default">default</option>
              <option value="0">0</option>
              <option value="1000">1000</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            staleTime
            <select
              value={
                readerOpts.staleTime === undefined
                  ? "default"
                  : String(readerOpts.staleTime)
              }
              onChange={(event) => {
                const raw = event.target.value;
                ops.setReaderOpts({
                  ...readerOpts,
                  staleTime: raw === "default" ? undefined : Number(raw),
                });
              }}
              className="rounded border border-zinc-300 px-1 py-0.5"
            >
              <option value="default">default</option>
              <option value="0">0</option>
              <option value="5000">5000</option>
              <option value="60000">60000</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">シナリオランナー(1–18)</h2>
          {running === null ? (
            <span className="text-xs text-zinc-400">idle</span>
          ) : (
            <span className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-rose-600">
                #{running.id} 実行中
              </span>
              <span className="max-w-xs truncate font-mono text-zinc-500">
                {stepLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                  abortRef.current = true;
                }}
                className="rounded border border-rose-300 px-2 py-0.5 text-rose-700 hover:bg-rose-50"
              >
                abort
              </button>
            </span>
          )}
        </div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              disabled={running !== null || !mounted}
              onClick={() => void runScenario(scenario)}
              title={scenario.focus}
              className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-left text-xs hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="mr-1 font-mono font-semibold">
                {scenario.id}.
              </span>
              {scenario.title}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-500">
          各ステップは Timeline の matrix:scenario チャンネルに custom
          イベントで印を打つ。#18 は手動(ヘッダの StrictMode トグル /
          ?strict=1 で再走)。シナリオは現在の reader opts のまま走る(#6 を除く)。
        </p>
      </section>

      {mounted ? (
        <div key={epoch} className="grid gap-3 lg:grid-cols-2">
          {runtimes.map((runtime) => (
            <Quadrant
              key={runtime.id}
              runtime={runtime}
              mode={mode}
              variant={variant}
              readerOpts={readerOpts}
              snapshots={runtime.hasHydration ? snapshots : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-400">
          booting client island…
        </div>
      )}

      <section className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">timeline filter:</span>
          {QUADRANT_IDS.map((id) => {
            const active = channelFilter.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setChannelFilter((current) =>
                    current.includes(id)
                      ? current.filter((entry) => entry !== id)
                      : [...current, id],
                  )
                }
                className={`rounded border px-2 py-0.5 font-mono text-xs ${
                  active
                    ? "border-zinc-700 bg-zinc-800 text-white"
                    : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {id}
              </button>
            );
          })}
          <span className="text-[10px] text-zinc-400">
            (未選択 = 全 matrix チャンネル)
          </span>
        </div>
        <Timeline channels={timelineChannels} maxClusters={60} />
      </section>

      <Link href="/" className="text-sm text-zinc-500 underline">
        back
      </Link>
    </main>
  );
}
