import { QuietMarker } from "../page-parts";

// Deliberately publishes nothing: no <LaneHydration>, no snapshot, no dynamic
// API. Landing here cold is the only way to see what an external read does when
// its key never arrives.
export default function QuietPage() {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/outside-reader/quiet</h1>
      <QuietMarker route="quiet" />
    </main>
  );
}
