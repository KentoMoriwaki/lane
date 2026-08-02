"use client";

import { useRouter } from "next/navigation";
import { Suspense, use } from "react";
import { PathnameProbe } from "../../../pathname-probe";
import { PhotoProbe, SeedFallback } from "../../../route-probes";

// A soft navigation to /bfcache/photo/[id] from inside /bfcache lands here,
// in the @modal slot, while the children slot keeps the page the user was on.
// The probe channels are suffixed -modal so the Timeline separates this mount
// point from the full page reading the same key.
function ModalBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return <PhotoProbe route="photo-modal" id={id} />;
}

export default function PhotoModalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();

  return (
    <div className="mt-3 space-y-2 rounded-lg border-2 border-indigo-400 bg-indigo-50 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-bold text-indigo-800">
          @modal — intercepted /bfcache/photo/[id]
        </span>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-indigo-400 bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          close (router.back)
        </button>
      </div>
      <PathnameProbe route="photo-modal" />
      <Suspense fallback={<SeedFallback route="photo-modal" />}>
        <ModalBody params={params} />
      </Suspense>
    </div>
  );
}
