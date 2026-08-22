const checklist = [
  "Hidden set -> reveal. On B, lane.set(K1, …) while A is hidden, then browser back. Read the first painted frame of A: does it carry the written value, and did any SUSPENDED frame paint on the way?",
  "Visible invalidate -> SWR. On A, invalidate K1 with its reader on screen. Expect one refresh() call, one server render, and the old value held with tr:1 for the whole round trip.",
  "Hidden invalidate -> back. On B, invalidate K1. Nothing read it, so nothing asked; the reveal's re-read is what asks. Count the fallback frames between the reveal and the new publication.",
  "Refresh discarded by navigation. Set the delay to 1500ms, invalidate on A, navigate to B before the payload lands (Next discards pending actions on navigation), wait past the delay, then go back. The reveal re-reads a wait nobody filled — does it ask again?",
  "Burst. One click invalidating K1, K2 and K3 with all three visible. One refresh() or three?",
];

export default function OwnerAskIndexPage() {
  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">/owner-ask — what a read asks its owner for</h1>
        <p className="mt-1 text-sm text-zinc-600">
          One lane, three published keys, two routes. <code>/owner-ask/a</code>{" "}
          is the owner: its RSC render seeds <code>K1 K2 K3</code> through{" "}
          <code>{"<LaneHydration>"}</code> and its probes read them with{" "}
          <code>loader: external</code>. <code>/owner-ask/b</code> publishes
          nothing, so standing there makes A a hidden{" "}
          <code>{"<Activity>"}</code> whose readers are off screen. The shell
          wires <code>{"<LaneProvider refresh>"}</code> to{" "}
          <code>router.refresh()</code> and counts the calls, so every
          measurement reads three numbers at once: painted frames, asks, and
          server renders.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <h2 className="text-sm font-semibold">
          Observation checklist (record what happens in OBSERVATIONS.md)
        </h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>

      <p className="text-xs text-zinc-500">
        The server counter in A&apos;s header (<code>server render #N</code>) and
        the versions in the values (<code>k1 vN (rsc)</code>) both advance once
        per RSC render of A; <code>GET /owner-ask/api</code> reports the counter
        without being one. Client writes are{" "}
        <code>client-vN</code> (<code>set</code>) and <code>client-uN</code> (
        <code>update</code>). The delay buttons set a cookie the route reads, so
        an ask&apos;s round trip is as slow as the first load.
      </p>
    </main>
  );
}
