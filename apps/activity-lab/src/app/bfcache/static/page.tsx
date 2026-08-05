import { Suspense } from "react";
import { LaneHydration, laneSnapshot } from "use-lane";
import { bfPublished } from "../reads";
import { SnapshotIdentityProbe } from "../ident-probe";
import { PathnameProbe } from "../pathname-probe";
import { RouteProbe, SeedFallback } from "../route-probes";

// Deliberately static: no dynamic API anywhere on this route, so the payload
// is prerenderable. What the identity probe reports on a revisit — SAME
// (cached client tree replayed) vs NEW (payload re-streamed) — is the token
// question for routes the server never re-renders.
const STATIC_VALUE = "static s1 (rsc)";

export default function StaticPage() {
  const snapshots = {
    entries: [laneSnapshot(bfPublished.static(), STATIC_VALUE)],
  };

  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/bfcache/static</h1>
      <PathnameProbe route="static" />
      <SnapshotIdentityProbe route="static" snapshots={snapshots} />
      <Suspense fallback={<SeedFallback route="static" />}>
        <LaneHydration snapshots={snapshots}>
          <RouteProbe route="static" name="static" />
        </LaneHydration>
      </Suspense>
    </main>
  );
}
