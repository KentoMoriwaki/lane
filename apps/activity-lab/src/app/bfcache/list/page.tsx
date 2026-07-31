import { connection } from "next/server";
import { Suspense } from "react";
import { LaneHydration, laneSnapshot } from "use-lane";
import { nextValue } from "@/server/bfcache-data";
import { bfReads } from "../reads";
import { RouteProbes, SeedFallback } from "../route-probes";

// `connection()` keeps the seed out of the static shell: without it the
// versioned values would be computed once at prerender and every navigation
// would replay the same snapshot, hiding exactly the re-seed-vs-reveal
// distinction this route exists to observe.
async function SeededList() {
  await connection();

  const snapshots = {
    entries: [
      laneSnapshot(bfReads.list(), nextValue("list", "rsc")),
      laneSnapshot(bfReads.shared(), nextValue("shared", "rsc")),
    ],
  };

  return (
    <LaneHydration snapshots={snapshots}>
      <RouteProbes route="list" />
    </LaneHydration>
  );
}

export default function ListPage() {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/bfcache/list</h1>
      <Suspense fallback={<SeedFallback route="list" />}>
        <SeededList />
      </Suspense>
    </main>
  );
}
