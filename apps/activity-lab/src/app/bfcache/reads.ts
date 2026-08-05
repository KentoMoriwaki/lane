import { external, laneRead, type LaneLoader } from "use-lane";
import { labLog } from "@/lab/log";

// No "use client" — the RSC pages import these reads to name their snapshot
// entries (laneSnapshot takes the read, never calls the loader), while the
// client probes read with the very same definitions.
//
// The scene is split down the middle on purpose, because the two halves ask
// different questions of a restore and one read cannot ask both:
//
// - **Published keys** (`loader: external`, seeded by the route's RSC render)
//   belong to the server. A restore asks whether the published value is still
//   *reachable* — the lane holds it weakly and the payload is what tethers it,
//   so a route tree the LRU evicted takes its values with it — and whether the
//   revisit re-streams a payload to republish them. There is no loader to fire;
//   a read that finds nothing waits for the next publication and fails on the
//   timeout, which is itself the reading: collected, and nobody re-supplied it.
// - **Client-owned keys** (a real loader, never seeded) belong to the browser.
//   A restore asks whether the loader runs again — whether the entry outlived
//   `gcTime`, and what the reveal reconciliation does with what it finds.
//
// Seeding a key that has a client loader is neither, which is why nothing here
// does it any more. Publishing marks a key external for good, so such a read
// would keep its loader and lose everything that comes with owning a key: no
// stale-on-error fallback, no `current` for the next load, no structural
// sharing, and HUD writes that throw. Lane warns about the combination in
// development.
const loaders = new Map<string, LaneLoader<string>>();

function loaderFor(name: string): LaneLoader<string> {
  const existing = loaders.get(name);

  if (existing) {
    return existing;
  }

  const channel = `bfcache:loader:${name}`;
  const loader: LaneLoader<string> = async ({ signal }) => {
    labLog.push(channel, "loader-call");
    const response = await fetch(
      `/bfcache/api?name=${encodeURIComponent(name)}`,
      { signal },
    );

    if (!response.ok) {
      throw new Error(`/bfcache/api responded ${response.status}`);
    }

    const { data } = (await response.json()) as { data: string };
    labLog.push(channel, "loader-settle", data);
    return data;
  };

  loaders.set(name, loader);
  return loader;
}

/**
 * Server-owned. Every one of these is seeded by the route that renders it, so
 * every one is read with `external` — no loader, and the value arrives as a
 * publication or not at all.
 */
export const bfPublished = {
  /** Read by every /bfcache route, re-seeded by list and by detail. */
  shared: () => laneRead<string>({ key: ["bf", "shared"], loader: external }),
  list: () => laneRead<string>({ key: ["bf", "list"], loader: external }),
  detail: (id: string) =>
    laneRead<string>({ key: ["bf", "detail", id], loader: external }),
  /** Seeded by the fully static route — no dynamic API touches the payload. */
  static: () => laneRead<string>({ key: ["bf", "static"], loader: external }),
  /** Seeded through a "use cache" function with its own hit-revealing counter. */
  cached: () => laneRead<string>({ key: ["bf", "cached"], loader: external }),
};

/**
 * Client-owned. Never named by any snapshot, always fetched by the browser.
 */
export const bfClient = {
  /**
   * One per route, mounted beside that route's published probes. Its loader
   * firing on a restore is the whole signal, and it is legible precisely
   * because the probes next to it have no loader to fire.
   */
  own: (route: string) =>
    laneRead({
      key: ["bf", "client", route],
      loader: loaderFor(`client/${route}`),
    }),
  /**
   * Read by /bfcache/photo/[id] and by its intercepted @modal twin — the two
   * mount points of the same key.
   */
  photo: (id: string) =>
    laneRead({
      key: ["bf", "photo", id],
      loader: loaderFor(`photo/${id}`),
    }),
};
