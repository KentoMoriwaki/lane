"use client";

import Link from "next/link";
import {
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createLane,
  LaneHydration,
  LaneProvider,
  laneSnapshot,
  type LaneHydrationSnapshots,
  type LaneKey,
} from "use-lane";
import {
  AgitatorControls,
  AgitatorTickProvider,
  createAgitator,
  RenderAgitator,
  TickConsumer,
} from "@/lab/agitator";
import { FrameStrip, useFrameRecorder } from "@/lab/frame-recorder";
import { labLog, type LabEvent } from "@/lab/log";
import { createLabLoader, type LabLoader } from "@/lab/loader";
import { Probe } from "@/lab/probe";
import { LabActivity, useLabVisibility } from "@/lab/shells";
import { Timeline } from "@/lab/timeline";

const ROUTES = ["list", "detail-1", "detail-2"] as const;
type RouteId = (typeof ROUTES)[number];

const ROUTE_KEYS: Record<RouteId, LaneKey> = {
  list: ["sim", "route", "list"],
  "detail-1": ["sim", "route", "detail-1"],
  "detail-2": ["sim", "route", "detail-2"],
};
const SHARED_KEY: LaneKey = ["sim", "shared"];

type KeyTarget = RouteId | "shared";
const KEY_TARGETS: readonly KeyTarget[] = [...ROUTES, "shared"];
const targetKey = (target: KeyTarget): LaneKey =>
  target === "shared" ? SHARED_KEY : ROUTE_KEYS[target];

type SnapshotState = {
  version: number;
  object: LaneHydrationSnapshots;
};

// Every route snapshot carries the shared key too — as each Next route's RSC
// payload would — so returning to one route re-publishes data another route's
// reader is showing.
function makeSnapshots(route: RouteId, version: number): SnapshotState {
  return {
    version,
    object: {
      entries: [
        laneSnapshot(ROUTE_KEYS[route], `own:${route}#s${version}`),
        laneSnapshot(SHARED_KEY, `shared@${route}#s${version}`),
      ],
    },
  };
}

const EMPTY_EVENTS: readonly LabEvent[] = [];

function LoaderPanel({ loader }: { loader: LabLoader }) {
  useSyncExternalStore(labLog.subscribe, labLog.snapshot, () => EMPTY_EVENTS);

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      <span className="w-16 font-bold">{loader.name}</span>
      <button
        type="button"
        onClick={() => loader.setMode(loader.mode === "auto" ? "manual" : "auto")}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100"
      >
        {loader.mode}
      </button>
      <button
        type="button"
        onClick={() => loader.resolveNext()}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100"
      >
        resolve next
      </button>
      <select
        value={loader.delay}
        onChange={(event) => loader.setDelay(Number(event.target.value))}
        className="rounded border border-zinc-300 bg-white px-1 py-0.5"
      >
        {[0, 200, 1000].map((ms) => (
          <option key={ms} value={ms}>
            delay {ms}ms
          </option>
        ))}
      </select>
      <span className="text-zinc-500">
        calls:{loader.calls} pending:{loader.pending}
      </span>
    </div>
  );
}

function HydrationFallback({ route }: { route: RouteId }) {
  labLog.push(`sim:${route}:hydration`, "custom", "hydration-fallback render");

  return (
    <div className="rounded border-2 border-dashed border-purple-500 bg-purple-100 px-2 py-1 font-mono text-sm font-bold text-purple-700">
      HYDRATING
    </div>
  );
}

function RouteBody({
  route,
  version,
  ownLoader,
  sharedLoader,
}: {
  route: RouteId;
  version: number;
  ownLoader: LabLoader;
  sharedLoader: LabLoader;
}) {
  labLog.push(`sim:${route}:body`, "render", `snapshot s${version}`);
  const visibility = useLabVisibility();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span data-visibility={route}>visibility:{visibility}</span>
        <TickConsumer channel={`sim:${route}:tick`} />
      </div>
      <Probe
        channel={`sim:${route}:own`}
        read={{ key: ROUTE_KEYS[route], loader: ownLoader.loader }}
        label={`own [sim,route,${route}]`}
      />
      <Probe
        channel={`sim:${route}:shared`}
        read={{ key: SHARED_KEY, loader: sharedLoader.loader }}
        label="shared [sim,shared]"
      />
    </div>
  );
}

function RouteScene({
  route,
  current,
  variant,
  snapshots,
  ownLoader,
  sharedLoader,
  setElement,
}: {
  route: RouteId;
  current: RouteId;
  variant: "opaque" | "instrumented";
  snapshots: SnapshotState;
  ownLoader: LabLoader;
  sharedLoader: LabLoader;
  setElement: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-2">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-500">
        <span>
          {route} {route === current ? "(visible)" : "(hidden)"}
        </span>
        <span className="font-mono normal-case">snapshot s{snapshots.version}</span>
      </div>
      <LabActivity
        mode={route === current ? "visible" : "hidden"}
        variant={variant}
        channel={`sim:${route}:activity`}
      >
        <div ref={setElement} className="rounded bg-white/60 p-2">
          <Suspense fallback={<HydrationFallback route={route} />}>
            <LaneHydration snapshots={snapshots.object}>
              <RouteBody
                route={route}
                version={snapshots.version}
                ownLoader={ownLoader}
                sharedLoader={sharedLoader}
              />
            </LaneHydration>
          </Suspense>
        </div>
      </LabActivity>
    </div>
  );
}

// `useFrameRecorder` re-attaches only when the ref object's identity changes,
// and the target element only exists after the mounted gate — so the ref is
// rebuilt around the element instead of mutated behind the hook's back.
function useRouteRecorder(flag: string) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ref = useMemo(() => ({ current: element }), [element]);
  const recorder = useFrameRecorder(ref, {
    flag: flag === "" ? undefined : flag,
  });
  return { recorder, setElement };
}

type PresetStep = { label: string; run: () => void };

export default function RouterSimPage() {
  const [lane] = useState(() => createLane());
  const [loaders] = useState<Record<KeyTarget, LabLoader>>(() => ({
    list: createLabLoader("list", { mode: "auto", delay: 200 }),
    "detail-1": createLabLoader("detail-1", { mode: "auto", delay: 200 }),
    "detail-2": createLabLoader("detail-2", { mode: "auto", delay: 200 }),
    shared: createLabLoader("shared", { mode: "auto", delay: 200 }),
  }));
  const [agitator] = useState(() => createAgitator("sim:agitator"));

  const [route, setRoute] = useState<RouteId>("list");
  const [snapshots, setSnapshots] = useState<Record<RouteId, SnapshotState>>(
    () => ({
      list: makeSnapshots("list", 1),
      "detail-1": makeSnapshots("detail-1", 1),
      "detail-2": makeSnapshots("detail-2", 1),
    }),
  );
  // The state above holds what renders; this mirror is what `navigate` reads,
  // because preset steps fire from setTimeout closures over stale state.
  const versionsRef = useRef<Record<RouteId, number>>({
    list: 1,
    "detail-1": 1,
    "detail-2": 1,
  });
  const routeRef = useRef<RouteId>("list");

  const [variant, setVariant] = useState<"opaque" | "instrumented">("opaque");
  const [republishOnReturn, setRepublishOnReturn] = useState(true);
  const [transitionNav, setTransitionNav] = useState(true);
  const [target, setTarget] = useState<KeyTarget>("detail-1");
  const [presetBusy, setPresetBusy] = useState(false);
  const [flag, setFlag] = useState("");
  const setCount = useRef(0);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const recorders = {
    list: useRouteRecorder(flag),
    "detail-1": useRouteRecorder(flag),
    "detail-2": useRouteRecorder(flag),
  };

  const navigate = (
    next: RouteId,
    options?: { republish?: boolean; transition?: boolean },
  ) => {
    const republish = options?.republish ?? republishOnReturn;
    const useTransition = options?.transition ?? transitionNav;
    const from = routeRef.current;
    routeRef.current = next;

    let nextSnapshots: SnapshotState | null = null;
    if (republish) {
      versionsRef.current[next] += 1;
      nextSnapshots = makeSnapshots(next, versionsRef.current[next]);
    }

    labLog.push(
      "sim:nav",
      "custom",
      `${from} -> ${next}${
        nextSnapshots !== null ? ` +snapshot s${nextSnapshots.version}` : ""
      }${useTransition ? "" : " (urgent)"}`,
    );

    const apply = () => {
      if (nextSnapshots !== null) {
        const snapshotState = nextSnapshots;
        setSnapshots((prev) => ({ ...prev, [next]: snapshotState }));
      }
      setRoute(next);
    };

    if (useTransition) {
      startTransition(apply);
    } else {
      apply();
    }
  };

  const runSteps = (name: string, steps: readonly PresetStep[]) => {
    if (presetBusy) {
      return;
    }
    setPresetBusy(true);
    labLog.push("sim:preset", "custom", `${name}: start`);
    steps.forEach((step, index) => {
      setTimeout(() => {
        labLog.push("sim:preset", "custom", `${name}: ${step.label}`);
        step.run();
        if (index === steps.length - 1) {
          setPresetBusy(false);
        }
      }, 500 * (index + 1));
    });
  };

  const runConflict = (which: "own" | "shared") => {
    const key = which === "own" ? ROUTE_KEYS["detail-1"] : SHARED_KEY;
    runSteps(`conflict(${which})`, [
      {
        label: "enter detail-1 (no snapshot)",
        run: () => navigate("detail-1", { republish: false }),
      },
      {
        label: "leave detail-1 -> list",
        run: () => navigate("list", { republish: false }),
      },
      {
        label: `remove ${JSON.stringify(key)} while detail-1 is hidden`,
        run: () => {
          labLog.push("sim:op", "lane-op", `remove ${JSON.stringify(key)}`);
          lane.remove(key);
        },
      },
      {
        label: "return to detail-1 + publish new snapshot",
        run: () => navigate("detail-1", { republish: true }),
      },
    ]);
  };

  const runKeepAlive = () => {
    runSteps("keep-alive", [
      {
        label: "-> detail-1 (no snapshot)",
        run: () => navigate("detail-1", { republish: false }),
      },
      {
        label: "-> list (no snapshot)",
        run: () => navigate("list", { republish: false }),
      },
      {
        label: "-> detail-1 (no snapshot)",
        run: () => navigate("detail-1", { republish: false }),
      },
      {
        label: "-> list (no snapshot)",
        run: () => navigate("list", { republish: false }),
      },
    ]);
  };

  const runOp = (kind: "invalidate" | "remove" | "set") => {
    const key = targetKey(target);
    if (kind === "invalidate") {
      labLog.push("sim:op", "lane-op", `invalidate ${target}`);
      lane.invalidate(key);
    } else if (kind === "remove") {
      labLog.push("sim:op", "lane-op", `remove ${target}`);
      lane.remove(key);
    } else {
      setCount.current += 1;
      const value = `set:${target}#${setCount.current}`;
      labLog.push("sim:op", "lane-op", `set ${target} = ${value}`);
      lane.set(key, value);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">/router-sim</h1>
        <p className="text-sm text-zinc-600">
          Mini router: every route subtree stays mounted inside a LabActivity,
          only the current one is visible. Each route owns a LaneHydration
          boundary; returning to a route publishes a new snapshot (version++)
          unless re-publish is off. Own keys are per-route, the shared key is in
          every route&apos;s snapshot.
        </p>
      </div>

      <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-zinc-500">shell</span>
            <select
              value={variant}
              onChange={(event) =>
                setVariant(event.target.value as "opaque" | "instrumented")
              }
              className="rounded border border-zinc-300 bg-white px-1 py-0.5"
            >
              <option value="opaque">opaque</option>
              <option value="instrumented">instrumented</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={republishOnReturn}
              onChange={(event) => setRepublishOnReturn(event.target.checked)}
            />
            <span>publish new snapshot on nav</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={transitionNav}
              onChange={(event) => setTransitionNav(event.target.checked)}
            />
            <span>navigate in transition</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">nav</span>
          {ROUTES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              className={`rounded border px-3 py-1 text-sm font-semibold ${
                id === route
                  ? "border-zinc-800 bg-zinc-800 text-white"
                  : "border-zinc-400 bg-white hover:bg-zinc-100"
              }`}
            >
              {id}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">lane op</span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value as KeyTarget)}
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm"
          >
            {KEY_TARGETS.map((id) => (
              <option key={id} value={id}>
                {id === "shared" ? "shared key" : `own key ${id}`}
              </option>
            ))}
          </select>
          {(["invalidate", "remove", "set"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => runOp(kind)}
              className="rounded border border-rose-300 bg-white px-2 py-1 text-sm hover:bg-rose-50"
            >
              {kind}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">presets</span>
          <button
            type="button"
            disabled={presetBusy}
            onClick={() => runConflict("own")}
            className="rounded border border-fuchsia-400 bg-white px-2 py-1 text-sm font-semibold hover:bg-fuchsia-50 disabled:opacity-40"
          >
            conflict: remove own key of detail-1
          </button>
          <button
            type="button"
            disabled={presetBusy}
            onClick={() => runConflict("shared")}
            className="rounded border border-fuchsia-400 bg-white px-2 py-1 text-sm font-semibold hover:bg-fuchsia-50 disabled:opacity-40"
          >
            conflict: remove shared key
          </button>
          <button
            type="button"
            disabled={presetBusy}
            onClick={runKeepAlive}
            className="rounded border border-emerald-400 bg-white px-2 py-1 text-sm font-semibold hover:bg-emerald-50 disabled:opacity-40"
          >
            keep-alive round trip
          </button>
          {presetBusy && (
            <span className="text-xs text-amber-600">running…</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">agitator</span>
          <AgitatorControls agitator={agitator} />
        </div>

        <div className="space-y-1 border-t border-zinc-100 pt-2">
          {KEY_TARGETS.map((id) => (
            <LoaderPanel key={id} loader={loaders[id]} />
          ))}
        </div>
      </section>

      {mounted ? (
        <LaneProvider lane={lane}>
          <AgitatorTickProvider agitator={agitator}>
            <RenderAgitator agitator={agitator}>
              <div className="grid gap-3 md:grid-cols-3">
                {ROUTES.map((id) => (
                  <RouteScene
                    key={id}
                    route={id}
                    current={route}
                    variant={variant}
                    snapshots={snapshots[id]}
                    ownLoader={loaders[id]}
                    sharedLoader={loaders.shared}
                    setElement={recorders[id].setElement}
                  />
                ))}
              </div>
            </RenderAgitator>
          </AgitatorTickProvider>
        </LaneProvider>
      ) : (
        <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-400">
          booting client island…
        </div>
      )}

      <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>frame flag</span>
          <input
            value={flag}
            onChange={(event) => setFlag(event.target.value)}
            placeholder="highlight frames containing…"
            className="w-64 rounded border border-zinc-300 px-2 py-0.5 font-mono"
          />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {ROUTES.map((id) => (
            <FrameStrip
              key={id}
              recorder={recorders[id].recorder}
              label={id}
            />
          ))}
        </div>
      </section>

      <Timeline channels={["sim", "loader"]} />

      <Link href="/" className="text-sm text-zinc-500 underline">
        back
      </Link>
    </main>
  );
}
