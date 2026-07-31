"use client";

import { labLog } from "@/lab/log";
import { Probe } from "@/lab/probe";
import { bfReads } from "./reads";

export function RouteProbes({ route, id }: { route: string; id?: string }) {
  const own = id === undefined ? bfReads.list() : bfReads.detail(id);
  const shared = bfReads.shared();

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Probe
        channel={`bfcache:${route}:own`}
        read={own}
        label={`own — key ${JSON.stringify(own.key)}`}
      />
      <Probe
        channel={`bfcache:${route}:shared`}
        read={shared}
        label={`shared — key ${JSON.stringify(shared.key)}`}
      />
    </div>
  );
}

// The read is built here, not passed in: an RSC page cannot hand a loader
// function across the client boundary.
export function RouteProbe({
  route,
  name,
}: {
  route: string;
  name: "static" | "cached";
}) {
  const read = bfReads[name]();

  return (
    <Probe
      channel={`bfcache:${route}:own`}
      read={read}
      label={`own — key ${JSON.stringify(read.key)}`}
    />
  );
}

export function SeedFallback({ route }: { route: string }) {
  labLog.push(`bfcache:${route}`, "custom", "seed-fallback render");

  return (
    <div className="animate-pulse rounded border-2 border-dashed border-orange-500 bg-orange-100 px-2 py-4 text-center font-mono text-sm font-bold text-orange-700">
      seeding {route}…
    </div>
  );
}
