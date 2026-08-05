import { Suspense } from "react";
import { LaneHydration, laneSnapshot } from "use-lane";
import { cachedValue } from "@/server/cached-data";
import { bfPublished } from "../reads";
import { SnapshotIdentityProbe } from "../ident-probe";
import { PathnameProbe } from "../pathname-probe";
import { RouteProbe, SeedFallback } from "../route-probes";

// The seed comes through "use cache": within the cache lifetime a revisit is
// served the same vN. The open question is the transport — SAME (client tree
// replayed, token silent) vs NEW (payload re-streamed with equal values,
// token fires).
async function SeededCached() {
  const snapshots = {
    entries: [laneSnapshot(bfPublished.cached(), await cachedValue("route"))],
  };

  return (
    <>
      <SnapshotIdentityProbe route="cached" snapshots={snapshots} />
      <LaneHydration snapshots={snapshots}>
        <RouteProbe route="cached" name="cached" />
      </LaneHydration>
    </>
  );
}

export default function CachedPage() {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/bfcache/cached</h1>
      <PathnameProbe route="cached" />
      <Suspense fallback={<SeedFallback route="cached" />}>
        <SeededCached />
      </Suspense>
    </main>
  );
}
