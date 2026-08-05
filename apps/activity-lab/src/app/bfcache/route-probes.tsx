"use client";

import dynamic from "next/dynamic";
import { labLog } from "@/lab/log";
import { Probe } from "@/lab/probe";
import { bfPublished } from "./reads";

// Client-owned by definition, so its read begins in the browser — see
// `client-probe.tsx` for why prerendering one is not merely wasteful here.
const ClientOwnedProbe = dynamic(() => import("./client-probe"), {
  ssr: false,
  loading: () => (
    <div className="rounded border border-dashed border-zinc-300 bg-white p-2 font-mono text-[10px] text-zinc-400">
      client-owned — browser only
    </div>
  ),
});

// Every route mounts both ownerships, so one restore reads both at once: the
// published probes answer "did the seed survive, or did the revisit republish
// it", the client probe answers "did the loader run again". A loader call in
// the Timeline belongs to the client probe by construction — the published ones
// have none.
export function RouteProbes({ route, id }: { route: string; id?: string }) {
  const own = id === undefined ? bfPublished.list() : bfPublished.detail(id);
  const shared = bfPublished.shared();

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Probe
        channel={`bfcache:${route}:own`}
        read={own}
        label={`own — published — key ${JSON.stringify(own.key)}`}
      />
      <Probe
        channel={`bfcache:${route}:shared`}
        read={shared}
        label={`shared — published — key ${JSON.stringify(shared.key)}`}
      />
      <ClientOwnedProbe route={route} />
    </div>
  );
}

// The read is built here, not passed in: an RSC page cannot hand a loader
// function across the client boundary. These two routes exist for the transport
// question (does a revisit re-stream the payload), so they carry the published
// probe alone — the client-owned contrast lives on list / detail, where the
// navigations under observation actually happen.
export function RouteProbe({
  route,
  name,
}: {
  route: string;
  name: "static" | "cached";
}) {
  const read = bfPublished[name]();

  return (
    <Probe
      channel={`bfcache:${route}:own`}
      read={read}
      label={`own — published — key ${JSON.stringify(read.key)}`}
    />
  );
}

// One key, two mount points: the full page and the intercepted modal build the
// identical read, so whichever is on screen is a visible reader of
// ["bf","photo",id]. The channel tells them apart in the Timeline. Client-owned
// like the probe above, and browser-only for the same reason — which also
// settles the SSR error this route used to fall back to client rendering on.
export function PhotoProbe({ route, id }: { route: string; id: string }) {
  return <ClientOwnedProbe route={route} photoId={id} />;
}

export function SeedFallback({ route }: { route: string }) {
  labLog.push(`bfcache:${route}`, "custom", "seed-fallback render");

  return (
    <div className="animate-pulse rounded border-2 border-dashed border-orange-500 bg-orange-100 px-2 py-4 text-center font-mono text-sm font-bold text-orange-700">
      seeding {route}…
    </div>
  );
}
