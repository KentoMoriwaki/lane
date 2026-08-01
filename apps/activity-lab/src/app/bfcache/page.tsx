const checklist = [
  "On returning to a cached route, does Next only reveal the hidden tree, or does it stream a new RSC payload (new snapshot props -> LaneHydration re-seeds)? Read: seed-fallback / (rsc) version bumps in the Timeline vs. a bare reveal.",
  "Remove (or invalidate / set) a key from the HUD while on another route, then navigate back. Read the return frame by frame in the FrameStrip and the probe render / passive-mount order in the Timeline.",
  "Repeat 1-2 with partial prefetching off: LAB_PARTIAL_PREFETCH=0 pnpm --filter @lane/activity-lab dev.",
  "Visit all four routes so the LRU evicts the oldest tree, then navigate back to the evicted route. Compare against the kept-alive case (probes remount from scratch vs. reveal).",
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
          are client readers of those same keys. A probe&apos;s
          passive-cleanup is the evidence of a hide; a render logged while
          hidden is the evidence of offscreen rendering.
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
        Keys: <code>[&quot;bf&quot;,&quot;list&quot;]</code> /{" "}
        <code>[&quot;bf&quot;,&quot;detail&quot;,id]</code> (route-owned) and{" "}
        <code>[&quot;bf&quot;,&quot;shared&quot;]</code> (read by every route,
        re-seeded by every route&apos;s RSC render, writable from the HUD while
        any route is hidden). Values are versioned server-side per fetch:{" "}
        <code>name vN (rsc | loader)</code>; HUD writes are{" "}
        <code>set#N (hud)</code>.
      </p>
    </main>
  );
}
