import { external, laneRead } from "use-lane";

// No "use client": the RSC pages import these to name their snapshot entries
// (`laneSnapshot` takes the read and never calls a loader), and the client
// components read with the identical definitions. `external` is a value, not a
// client reference — the barrel carries no "use client" for exactly this.

/** What every publication in this scene carries. An object, not a string, so the
 * WeakRef probe has something to hold weakly. */
export type OutsideTopic = { text: string; n: number };

export const outsideReads = {
  /**
   * The key the layout-level reader reads and the pages publish. `alpha` and
   * `beta` publish different values for it; `quiet` and the index publish
   * nothing at all.
   */
  topic: () =>
    laneRead<OutsideTopic>({ key: ["outside", "topic"], loader: external }),
  /**
   * One key per publishing route, read only inside that route's own subtree.
   * The shared `topic` key cannot answer "did *this* route's value survive?" —
   * every publication overwrites it — so retention is measured on a key only one
   * route ever publishes.
   */
  route: (label: string) =>
    laneRead<OutsideTopic>({
      key: ["outside", "route", label],
      loader: external,
    }),
  /**
   * Published only from the client, by the synthetic publisher in the HUD, whose
   * snapshots object nothing but that component holds. The positive control for
   * WeakRef reclamation: unmount the publisher and the last strong reference to
   * the value is gone.
   */
  synthetic: () =>
    laneRead<OutsideTopic>({ key: ["outside", "synthetic"], loader: external }),
};
