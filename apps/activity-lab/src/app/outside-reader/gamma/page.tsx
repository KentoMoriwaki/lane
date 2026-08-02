import { SeededRoute } from "../seeded";

// The fourth route at this level: visiting it is what evicts the oldest hidden
// <Activity> (1 visible + 2 hidden is the whole budget — see
// RESEARCH-next-router-caches.md §3).
export default function GammaPage() {
  return <SeededRoute label="gamma" delayMs={100} />;
}
