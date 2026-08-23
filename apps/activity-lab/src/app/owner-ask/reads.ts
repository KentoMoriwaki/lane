import { external, laneRead } from "use-lane";

// No "use client": /owner-ask/a imports these from its RSC render to name the
// snapshot entries, and the client probes read with the very same definitions.
//
// All three keys are published — `loader: external`, seeded by route A, no
// loader to fire. The scene has no client-owned half on purpose: what it
// measures is the owner-ask, and only a published key has an owner to ask.
export const oa = {
  k1: () => laneRead<string>({ key: ["oa", "k1"], loader: external }),
  k2: () => laneRead<string>({ key: ["oa", "k2"], loader: external }),
  k3: () => laneRead<string>({ key: ["oa", "k3"], loader: external }),
};
