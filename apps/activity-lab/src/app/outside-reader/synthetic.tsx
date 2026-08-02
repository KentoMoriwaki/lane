"use client";

import { Suspense, use, useLayoutEffect, useState } from "react";
import { LaneHydration, laneSnapshot, useLane } from "use-lane";
import { labLog } from "@/lab/log";
import { outsideReads, type OutsideTopic } from "./reads";
import { trackValue } from "./weak-probe";

const CHANNEL = "outside:synthetic";

/**
 * A publication whose payload **only this component holds**.
 *
 * Everything a page publishes is reachable from the RSC payload the router
 * keeps, which is the whole point of the retention design — and also why a
 * page-published value is a poor test of it. This publisher builds its snapshots
 * object in client state, so unmounting it drops the last strong reference the
 * publication side has. What survives after that is exactly what the design
 * says survives: committed readers, and nothing else.
 */
let syntheticCounter = 0;

function SyntheticReader() {
  const result = useLane(outsideReads.synthetic());
  const value = use(result.promise);

  useLayoutEffect(() => {
    labLog.push(CHANNEL, "custom", `reader committed ${value.data.text}`);
  }, [value.data.text]);

  return (
    <span className="font-mono text-xs text-sky-800" data-synthetic-value="">
      {value.data.text}
    </span>
  );
}

function SyntheticPublisher({ withReader }: { withReader: boolean }) {
  // The snapshots object lives here and nowhere else — no module scope, no ref
  // that outlives the component, no logging of the object itself.
  const [snapshots] = useState(() => {
    const n = ++syntheticCounter;
    const data: OutsideTopic = { n, text: `synthetic s${n} (client)` };

    trackValue("synthetic", n, data);
    labLog.push(CHANNEL, "custom", `publish synthetic s${n}`);

    return { entries: [laneSnapshot(outsideReads.synthetic(), data)] };
  });

  useLayoutEffect(() => {
    labLog.push(CHANNEL, "layout-mount");
    return () => {
      labLog.push(CHANNEL, "layout-cleanup");
    };
  }, []);

  return (
    <Suspense fallback={<span className="text-xs text-orange-600">publishing…</span>}>
      <LaneHydration snapshots={snapshots}>
        {withReader ? (
          <SyntheticReader />
        ) : (
          <span className="text-xs text-zinc-500">published (no reader)</span>
        )}
      </LaneHydration>
    </Suspense>
  );
}

export function SyntheticPanel() {
  const [mounted, setMounted] = useState(false);
  const [withReader, setWithReader] = useState(false);
  const [generation, setGeneration] = useState(0);

  return (
    <div className="space-y-1 rounded border border-sky-300 bg-sky-50 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
        synthetic publisher — payload held only by this component
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setGeneration((value) => value + 1);
            setMounted(true);
          }}
          className="rounded border border-sky-400 bg-white px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
        >
          publish
        </button>
        <button
          type="button"
          onClick={() => {
            labLog.push(CHANNEL, "custom", "unmount publisher");
            setMounted(false);
          }}
          className="rounded border border-zinc-400 bg-white px-2 py-1 text-xs font-semibold hover:bg-zinc-100"
        >
          unmount publisher
        </button>
        <label className="flex items-center gap-1 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={withReader}
            onChange={(event) => setWithReader(event.target.checked)}
          />
          keep a reader inside
        </label>
        {mounted && <SyntheticPublisher key={generation} withReader={withReader} />}
      </div>
    </div>
  );
}
