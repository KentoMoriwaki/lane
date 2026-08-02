import { connection } from "next/server";
import { Suspense } from "react";
import { LaneHydration, laneSnapshot } from "use-lane";
import { nextTopic } from "@/server/outside-data";
import { PagePanel, SeedFallback } from "./page-parts";
import { outsideReads } from "./reads";

/**
 * A route that publishes the shared key.
 *
 * `connection()` keeps the seed out of the static shell — without it the value
 * is computed once at build time and every navigation replays the same
 * publication, which would hide the very thing this scene measures. The delay
 * that follows separates the phases: whatever the layout-level reader shows
 * during that window is what it shows while a publication is in flight.
 */
async function Seeded({ label, delayMs }: { label: string; delayMs: number }) {
  await connection();
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const snapshots = {
    entries: [
      laneSnapshot(outsideReads.topic(), nextTopic(label)),
      laneSnapshot(outsideReads.route(label), nextTopic(`${label}-own`)),
    ],
  };

  return (
    <LaneHydration snapshots={snapshots}>
      <PagePanel route={label} />
    </LaneHydration>
  );
}

export function SeededRoute({
  label,
  delayMs,
}: {
  label: string;
  delayMs: number;
}) {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/outside-reader/{label}</h1>
      <p className="text-[10px] text-zinc-500">
        publishes [&quot;outside&quot;,&quot;topic&quot;] after {delayMs}ms
      </p>
      <Suspense fallback={<SeedFallback route={label} />}>
        <Seeded label={label} delayMs={delayMs} />
      </Suspense>
    </main>
  );
}
