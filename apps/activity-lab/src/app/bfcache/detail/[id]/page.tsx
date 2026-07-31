import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LaneHydration, laneSnapshot } from "use-lane";
import { nextValue } from "@/server/bfcache-data";
import { bfReads } from "../../reads";
import { RouteProbes, SeedFallback } from "../../route-probes";

const IDS = ["1", "2", "3"];

// See list/page.tsx for why `connection()` guards the seed.
async function SeededDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!IDS.includes(id)) {
    notFound();
  }

  await connection();

  const snapshots = {
    entries: [
      laneSnapshot(bfReads.detail(id), nextValue(`detail/${id}`, "rsc")),
      laneSnapshot(bfReads.shared(), nextValue("shared", "rsc")),
    ],
  };

  return (
    <LaneHydration snapshots={snapshots}>
      <RouteProbes route={`detail/${id}`} id={id} />
    </LaneHydration>
  );
}

export default function DetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/bfcache/detail/[id]</h1>
      <Suspense fallback={<SeedFallback route="detail" />}>
        <SeededDetail params={params} />
      </Suspense>
    </main>
  );
}
