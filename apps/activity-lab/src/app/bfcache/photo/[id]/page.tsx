import { Suspense } from "react";
import { PathnameProbe } from "../../pathname-probe";
import { PhotoProbe, SeedFallback } from "../../route-probes";

// The non-intercepted target: a hard load or a navigation from outside
// /bfcache lands here, in the children slot. Client-owned key, no seed —
// pattern B's home turf.
async function PhotoBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <PhotoProbe route="photo-page" id={id} />;
}

export default function PhotoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/bfcache/photo/[id]</h1>
      <PathnameProbe route="photo-page" />
      <Suspense fallback={<SeedFallback route="photo-page" />}>
        <PhotoBody params={params} />
      </Suspense>
    </main>
  );
}
