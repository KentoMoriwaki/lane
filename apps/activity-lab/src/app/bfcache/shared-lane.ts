import { createLane } from "use-lane";

// Module scope, not component state: Next keeps up to three inactive /bfcache
// route trees alive under <Activity>, and the HUD mutates entries while a tree
// is hidden — the store has to sit above every tree and outlive any single
// mount of the layout shell.
export const bfcacheLane = createLane();
