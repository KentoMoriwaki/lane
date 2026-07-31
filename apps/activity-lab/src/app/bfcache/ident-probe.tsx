"use client";

import type { LaneHydrationSnapshots } from "use-lane";
import { labLog } from "@/lab/log";

// The token design hinges on whether a revisit hands the client a NEW
// snapshots object (payload streamed → republish → token fires) or replays
// the cached tree (identity unchanged → token silent). Identity must be
// compared across renders, so the previous object lives outside React —
// per-route, surviving hide/reveal.
const lastSeen = new Map<string, LaneHydrationSnapshots>();

export function SnapshotIdentityProbe({
  route,
  snapshots,
}: {
  route: string;
  snapshots: LaneHydrationSnapshots;
}) {
  const prev = lastSeen.get(route);
  const verdict =
    prev === undefined ? "first" : prev === snapshots ? "SAME" : "NEW";
  lastSeen.set(route, snapshots);

  const fingerprint = snapshots.entries
    .map((entry) => String(entry.data))
    .join(" | ");
  labLog.push(
    `bfcache:${route}:ident`,
    "custom",
    `snapshots ${verdict} [${fingerprint}]`,
  );

  return (
    <div className="font-mono text-[10px] text-zinc-500" data-ident={verdict}>
      snapshots: {verdict} — {fingerprint}
    </div>
  );
}
