const checklist = [
  "On returning to a cached route, does Next only reveal the hidden tree, or does it stream a new RSC payload (new snapshot props -> LaneHydration re-seeds)? Read: seed-fallback / (rsc) version bumps in the Timeline vs. a bare reveal.",
  "Compare the two ownerships on the same return. The published probes have no loader, so what they show is whatever the seed left reachable (or a wait, if it was collected and nothing republished); the client-owned probe beside them is the only one that can log a loader-call.",
  "Remove (or invalidate / set) a client-owned key from the HUD while on another route, then navigate back. Read the return frame by frame in the FrameStrip and the probe render / passive-mount order in the Timeline. The same buttons work on a published target too — there an invalidate empties the entry and the reveal asks the route to render again through the lane's `refresh`.",
  "Repeat 1-3 with partial prefetching off: LAB_PARTIAL_PREFETCH=0 pnpm --filter @lane/activity-lab dev.",
  "Visit all four routes so the LRU evicts the oldest tree, then navigate back to the evicted route. Compare against the kept-alive case (probes remount from scratch vs. reveal) — and note that evicting a tree also drops the payload tethering its published values.",
];

export default function BfcacheIndexPage() {
  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">/bfcache — real router keep-alive</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Real Next.js navigations under <code>cacheComponents</code>. The
          router bfcache keeps the last 3 inactive route trees mounted inside
          {" "}
          <code>{"<Activity mode=\"hidden\">"}</code>. Each route below is an
          RSC page that seeds a per-request versioned value into its own key
          and into the shared key via <code>LaneHydration</code>; the probes
          are client readers of those same keys, declared{" "}
          <code>loader: external</code> because the server owns them. Beside
          them each route mounts one <em>client-owned</em> key that is never
          seeded and always fetched by the browser — the two halves answer
          different questions about a restore and only the second one has a
          loader to fire. A probe&apos;s passive-cleanup is the evidence of a
          hide; a render logged while hidden is the evidence of offscreen
          rendering.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <h2 className="text-sm font-semibold">Observation checklist (no expected outcomes — record what happens in OBSERVATIONS.md)</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>

      <p className="text-xs text-zinc-500">
        Published keys (server-owned, <code>loader: external</code>):{" "}
        <code>[&quot;bf&quot;,&quot;list&quot;]</code> /{" "}
        <code>[&quot;bf&quot;,&quot;detail&quot;,id]</code> (route-owned) and{" "}
        <code>[&quot;bf&quot;,&quot;shared&quot;]</code>, re-seeded by every
        route&apos;s RSC render; HUD writes to these are refused. Client-owned
        keys (never seeded, browser-fetched):{" "}
        <code>[&quot;bf&quot;,&quot;client&quot;,route]</code> and{" "}
        <code>[&quot;bf&quot;,&quot;photo&quot;,id]</code>, which the HUD can
        write while any route is hidden. Values are versioned server-side per
        fetch: <code>name vN (rsc | loader)</code>; HUD writes are{" "}
        <code>set#N (hud)</code>.
      </p>
    </main>
  );
}
