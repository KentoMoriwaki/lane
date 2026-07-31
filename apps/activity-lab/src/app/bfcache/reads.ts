import { laneRead, type LaneLoader } from "use-lane";
import { labLog } from "@/lab/log";

// No "use client" — the RSC pages import these reads to name their snapshot
// entries (laneSnapshot takes the read, never calls the loader), while the
// client probes read with the very same definitions.
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

export const bfReads = {
  /** Read by every /bfcache route; the HUD's primary target. */
  shared: () => laneRead({ key: ["bf", "shared"], loader: loaderFor("shared") }),
  list: () => laneRead({ key: ["bf", "list"], loader: loaderFor("list") }),
  detail: (id: string) =>
    laneRead({ key: ["bf", "detail", id], loader: loaderFor(`detail/${id}`) }),
  /** Seeded by the fully static route — no dynamic API touches the payload. */
  static: () => laneRead({ key: ["bf", "static"], loader: loaderFor("static") }),
  /**
   * Never seeded (client-owned): read by /bfcache/photo/[id] and by its
   * intercepted @modal twin — the two mount points of the same key.
   */
  photo: (id: string) =>
    laneRead({ key: ["bf", "photo", id], loader: loaderFor(`photo/${id}`) }),
  /** Seeded through a "use cache" function with its own hit-revealing counter. */
  cached: () => laneRead({ key: ["bf", "cached"], loader: loaderFor("cached") }),
};
