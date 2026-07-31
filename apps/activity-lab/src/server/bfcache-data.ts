// Versions live for the dev-server process (a Turbopack HMR reload of this
// module resets them), which is exactly the lifetime the scene needs: every
// RSC render and every loader fetch must observably advance the data so the
// Timeline can tell a re-seeded value from a revealed stale one.
const versions = new Map<string, number>();

export type BfValueSource = "rsc" | "loader";

export function nextValue(name: string, via: BfValueSource): string {
  const version = (versions.get(name) ?? 0) + 1;
  versions.set(name, version);
  return `${name} v${version} (${via})`;
}
