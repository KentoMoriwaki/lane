"use client";

import { Suspense, use, useEffect, useLayoutEffect } from "react";
import { useLane } from "use-lane";
import { labLog } from "@/lab/log";
import { outsideReads } from "./reads";
import { trackValue } from "./weak-probe";

/**
 * The control reader: same key, same `external` loader, but **inside** the
 * page's `<LaneHydration>` boundary. Whatever differs between this and the
 * layout-level reader is the boundary's doing and nothing else.
 */
function InsideReader({ route, own }: { route: string; own?: boolean }) {
  const channel = `outside:${route}:${own ? "own" : "inside"}`;
  const result = useLane(
    own ? outsideReads.route(route) : outsideReads.topic(),
  );

  labLog.push(channel, "render");

  useLayoutEffect(() => {
    labLog.push(channel, "layout-mount");
    return () => {
      labLog.push(channel, "layout-cleanup");
    };
  }, [channel]);

  useEffect(() => {
    labLog.push(channel, "passive-mount");
    return () => {
      labLog.push(channel, "passive-cleanup");
    };
  }, [channel]);

  const value = use(result.promise);

  if (own) {
    trackValue(`route:${route}`, value.data.n, value.data);
  }

  return (
    <span
      className="font-mono text-sm font-bold"
      {...(own
        ? { "data-own-value": route }
        : { "data-inside-value": route })}
    >
      {value.data.text}
    </span>
  );
}

export function PagePanel({ route }: { route: string }) {
  return (
    <div className="space-y-1 rounded border border-zinc-300 bg-white p-2" data-route={route}>
      <div className="text-[10px] text-zinc-500">
        inside the boundary — shared key{" "}
        {JSON.stringify(outsideReads.topic().key)}
      </div>
      <Suspense
        fallback={
          <span className="font-mono text-sm text-orange-600">
            SUSPENDED (inside {route})
          </span>
        }
      >
        <InsideReader route={route} />
      </Suspense>
      <div className="text-[10px] text-zinc-500">
        route-scoped key {JSON.stringify(outsideReads.route(route).key)}
      </div>
      <Suspense
        fallback={
          <span className="font-mono text-sm text-orange-600">
            SUSPENDED (own {route})
          </span>
        }
      >
        <InsideReader route={route} own />
      </Suspense>
    </div>
  );
}

export function SeedFallback({ route }: { route: string }) {
  labLog.push(`outside:${route}`, "custom", "seed-fallback render");

  return (
    <div className="animate-pulse rounded border-2 border-dashed border-orange-400 bg-orange-50 px-2 py-3 text-center font-mono text-sm text-orange-700">
      seeding {route}…
    </div>
  );
}

export function QuietMarker({ route }: { route: string }) {
  labLog.push(`outside:${route}`, "custom", "route render (publishes nothing)");

  return (
    <div className="rounded border border-zinc-300 bg-white p-2 font-mono text-sm" data-route={route}>
      {route}: no &lt;LaneHydration&gt; on this route — it publishes nothing.
    </div>
  );
}
