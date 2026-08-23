"use client";

import { labLog } from "@/lab/log";
import { oa } from "./reads";
import { ownerAskLane } from "./shared-lane";

// Both routes mount this panel, and which one you press is the whole
// experiment: pressing it on B writes to a key whose only reader is inside the
// hidden A tree, pressing it on A writes to a key with a visible reader. The
// lane is a module singleton, so the panel needs nothing from the route it
// sits in — which is what makes the two positions comparable.

// Module scope so the value survives the hide: the first `set` is `client-v2`,
// which names it as the successor of the `v1` the route published.
let setSeq = 1;
let updateSeq = 0;

function op(where: string, name: string, run: () => void): void {
  labLog.push("owner-ask:op", "lane-op", `${name} · pressed on ${where}`);
  run();
}

const BUTTON =
  "rounded border px-2 py-1 font-mono text-xs font-semibold hover:bg-zinc-100";

export function OpsPanel({ where }: { where: string }) {
  const k1 = oa.k1().key;

  return (
    <div
      data-ops={where}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-white p-3"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        ops · on {where}
      </span>
      <button
        type="button"
        data-op="set-k1"
        onClick={() =>
          op(where, "set K1", () => {
            setSeq += 1;
            ownerAskLane.set(k1, `client-v${setSeq}`);
          })
        }
        className={`${BUTTON} border-emerald-400 text-emerald-700`}
      >
        set K1
      </button>
      <button
        type="button"
        data-op="update-k1"
        onClick={() =>
          op(where, "update K1", () => {
            updateSeq += 1;
            const seq = updateSeq;
            ownerAskLane.update(k1, () => `client-u${seq}`);
          })
        }
        className={`${BUTTON} border-emerald-400 text-emerald-700`}
      >
        update K1
      </button>
      <button
        type="button"
        data-op="invalidate-k1"
        onClick={() =>
          op(where, "invalidate K1", () => {
            ownerAskLane.invalidate(k1);
          })
        }
        className={`${BUTTON} border-rose-400 text-rose-700`}
      >
        invalidate K1
      </button>
      <button
        type="button"
        data-op="invalidate-all"
        // One synchronous run, three keys: the coalescing case. Whether this
        // costs one ask or three is the only thing separating it from pressing
        // `invalidate K1` three times.
        onClick={() =>
          op(where, "invalidate K1+K2+K3", () => {
            ownerAskLane.invalidate(oa.k1().key);
            ownerAskLane.invalidate(oa.k2().key);
            ownerAskLane.invalidate(oa.k3().key);
          })
        }
        className={`${BUTTON} border-rose-400 text-rose-700`}
      >
        invalidate K1+K2+K3
      </button>
      <span className="ml-2 text-[10px] text-zinc-400">server delay</span>
      {[0, 600, 1500].map((ms) => (
        <button
          key={ms}
          type="button"
          data-op={`delay-${ms}`}
          onClick={() => {
            labLog.push("owner-ask:op", "custom", `delay=${ms}ms`);
            void fetch("/owner-ask/api", {
              method: "POST",
              body: JSON.stringify({ delay: ms }),
            });
          }}
          className={`${BUTTON} border-zinc-300 text-zinc-600`}
        >
          {ms}ms
        </button>
      ))}
    </div>
  );
}
