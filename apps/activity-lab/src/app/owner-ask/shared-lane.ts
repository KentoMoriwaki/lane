import { createLane } from "use-lane";

// Module scope for the same reason /bfcache's lane is: the router keeps the
// inactive route tree alive under <Activity>, and the ops panel writes entries
// while a tree is hidden — the store has to sit above every tree. The `refresh`
// is installed by the shell's <LaneProvider>, not here, because it needs the
// router instance.
export const ownerAskLane = createLane();
