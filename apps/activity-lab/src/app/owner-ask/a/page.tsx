import { connection } from "next/server";
import { Suspense } from "react";
import { LaneHydration, laneSnapshot } from "use-lane";
import {
  countServerRender,
  currentDelay,
  nextOwnerValue,
} from "@/server/owner-ask-data";
import { OpsPanel } from "../ops";
import { OwnerAskProbes, SeedFallback } from "../probes";
import { oa } from "../reads";

// The owner. `connection()` is what keeps this hole dynamic, so every visit and
// every `router.refresh()` produces a new set of versions — without it a
// re-render would replay the same snapshot and "the owner answered" would be
// indistinguishable from "the tree was revealed". It is also the *only* dynamic
// API this render touches, on purpose: see `currentDelay`.
async function SeededA() {
  await connection();

  const delay = currentDelay();
  await new Promise((resolve) => setTimeout(resolve, delay));

  const render = countServerRender();
  const snapshots = {
    entries: [
      laneSnapshot(oa.k1(), nextOwnerValue("k1")),
      laneSnapshot(oa.k2(), nextOwnerValue("k2")),
      laneSnapshot(oa.k3(), nextOwnerValue("k3")),
    ],
  };

  return (
    <>
      <div
        data-server-renders={render}
        className="font-mono text-[10px] text-zinc-500"
      >
        server render #{render} · delay {delay}ms
      </div>
      <LaneHydration snapshots={snapshots}>
        <OwnerAskProbes />
      </LaneHydration>
    </>
  );
}

export default function OwnerAskAPage() {
  return (
    <main className="space-y-3" data-route="a">
      <h1 className="font-mono text-sm font-bold">
        /owner-ask/a — publishes K1 K2 K3
      </h1>
      {/* Outside the Suspense boundary: the panel has to stay pressable while
          the owner is re-rendering, and it needs nothing from the seed. */}
      <OpsPanel where="a" />
      <Suspense fallback={<SeedFallback />}>
        <SeededA />
      </Suspense>
    </main>
  );
}
