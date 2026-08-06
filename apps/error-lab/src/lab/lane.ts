import { createLane, laneRead } from "use-lane";
import type {
  Lane,
  LaneKeyOf,
  LaneLoader,
  LaneReadSpec,
  LaneWhenStale,
} from "use-lane";

/** Whether the loader fails. Read at the start of each call, never mid-flight. */
export type FailureMode = "never" | "always";

/**
 * What a run is set up with. Options live outside any world and outlive it:
 * they are what you set before running a recipe and keep set across runs, which
 * is what makes Reload useful and a browser reload useless.
 *
 * The world is handed a *getter* rather than a copy, so a switch flipped now is
 * read by the next loader call — no world rebuild, and no option threaded
 * through the store just to reach the loader.
 */
export type LabOptions = {
  failure: FailureMode;
  /** Passed straight to `useLane`. The read-time freshness behavior. */
  whenStale: LaneWhenStale;
  /**
   * Held as the label rather than the number, because the setting that matters
   * most is the one with no number: `none` is an absent `staleTime`, which is
   * `Infinity` — nothing is ever stale — and is what makes `whenStale` and the
   * revalidation triggers silent.
   */
  staleTime: StaleTimeSetting;
  /**
   * The revalidation triggers, which are a different mechanism from the two
   * above: those decide what a read does when it runs, these decide when a
   * refresh is fired from an effect. Both are gated by `staleTime` — a trigger
   * refreshes only what is stale — so with `staleTime: none` they are on and
   * silent, and development says so.
   *
   * `refetchOnReconnect` is left out: it cannot be provoked by hand the way a
   * tab switch provokes focus.
   */
  refetchOnMount: boolean;
  refetchOnFocus: boolean;
  /**
   * The one option here that is not a read's. It is handed to `createLane`, so
   * unlike the rest it is read once, when a world is built — flipping it asks
   * for a Reload, and the world prints the value it was built with.
   *
   * `infinity` is the default because the rig depends on it: a 5-minute GC
   * collecting a rejected entry on its own would look exactly like a recovery
   * this lab caused. `5s` is the deliberate opposite — short enough to watch an
   * idle entry actually go.
   */
  gcTime: GcTimeSetting;
};

export type GcTimeSetting = "infinity" | "5s";

export const GC_TIMES: Record<GcTimeSetting, number> = {
  infinity: Infinity,
  "5s": 5_000,
};

export type StaleTimeSetting = "none" | "0" | "5s";

export const STALE_TIMES: Record<StaleTimeSetting, number | undefined> = {
  none: undefined,
  "0": 0,
  "5s": 5_000,
};

export const initialOptions: LabOptions = {
  failure: "never",
  whenStale: "revalidate",
  staleTime: "none",
  refetchOnMount: false,
  refetchOnFocus: false,
  gcTime: "infinity",
};

/**
 * Everything a run of the lab is: a lane, the read it is exercised through, and
 * the instruments watching it. Built together and thrown away together, because
 * a first-load failure is only reachable from an empty store.
 */
export type LabWorld = {
  id: number;
  /** What it was built with, printed on it: the option can be changed, this cannot. */
  gcTime: GcTimeSetting;
  lane: Lane;
  read: LaneReadSpec<string> & { key: LaneKeyOf<string> };
  getCalls: () => number;
  subscribeCalls: (listener: () => void) => () => void;
};

let nextWorldId = 1;

export function createWorld(getOptions: () => LabOptions): LabWorld {
  // Read once, now: a lane's GC policy is fixed when it is built, which is why
  // that switch asks for a Reload where the others take effect immediately.
  const gcTime = getOptions().gcTime;
  const lane = createLane({ gcTime: GC_TIMES[gcTime] });

  // The instrument: how many times the loader ran. It must never subscribe to
  // the lane — `onInvalidate` / `onRemove` listeners land in `entry.subscribers`,
  // the very gate this lab exists to observe, so an instrument built on them
  // would be blocking the path it is there to measure. A counter and a store of
  // its own cannot.
  let calls = 0;
  const listeners = new Set<() => void>();

  const loader: LaneLoader<string> = async () => {
    calls += 1;
    const version = `v${calls}`;
    // Read once, here: flipping the switch while this call is in flight decides
    // the *next* call, not this one.
    const failing = getOptions().failure === "always";

    // The loader runs during a reader's render, so notifying synchronously
    // would be a store update in the middle of another component's render. One
    // tick is enough to put it after.
    queueMicrotask(() => {
      for (const listener of listeners) {
        listener();
      }
    });

    // Fixed delay so the Suspense fallback is actually on screen long enough to
    // be seen, rather than inferred.
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (failing) {
      throw new Error(`loader ${version} failed`);
    }

    return version;
  };

  return {
    id: nextWorldId++,
    gcTime,
    lane,
    read: laneRead({ key: ["lab"], loader }),
    getCalls: () => calls,
    subscribeCalls: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
