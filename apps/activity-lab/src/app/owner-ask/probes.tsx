"use client";

import { labLog } from "@/lab/log";
import { Probe } from "@/lab/probe";
import { oa } from "./reads";

// Three readers of three published keys, each behind its own Suspense: a
// fallback frame is per key, so "one key waited" and "all three waited" are
// different pictures in the strip.
export function OwnerAskProbes() {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Probe
        channel="owner-ask:k1"
        read={oa.k1()}
        label='K1 — published — ["oa","k1"]'
      />
      <Probe
        channel="owner-ask:k2"
        read={oa.k2()}
        label='K2 — published — ["oa","k2"]'
      />
      <Probe
        channel="owner-ask:k3"
        read={oa.k3()}
        label='K3 — published — ["oa","k3"]'
      />
    </div>
  );
}

export function SeedFallback() {
  labLog.push("owner-ask:a", "custom", "seed-fallback render");

  return (
    <div
      data-seed-fallback=""
      className="animate-pulse rounded border-2 border-dashed border-orange-500 bg-orange-100 px-2 py-4 text-center font-mono text-sm font-bold text-orange-700"
    >
      seeding a…
    </div>
  );
}
