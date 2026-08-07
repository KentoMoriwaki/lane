import { createLane, laneRead } from "use-lane";
import type { Lane, LaneKeyOf, LaneLoader, LaneReadSpec } from "use-lane";

/** Whether the loader fails. Read at the start of each call, never mid-flight. */
export type FailureMode = "never" | "always";

/**
 * What the *lane* is set up with. These are the settings that cannot belong to
 * one reader: what the loaders do, and how the store is built. Everything a
 * single read decides for itself lives on a {@link Variation} instead.
 *
 * They live outside any world and outlive it: they are what you set before
 * running a recipe and keep set across runs, which is what makes Reload useful
 * and a browser reload useless.
 */
export type LabOptions = {
  failure: FailureMode;
  /**
   * The one setting here that is read once, when a world is built, because that
   * is when `createLane` takes it — flipping it asks for a Reload, and the world
   * prints the value it was built with.
   *
   * `infinity` is the default because the rig depends on it: a 5-minute GC
   * collecting a rejected entry on its own would look exactly like a recovery
   * this lab caused. `5s` is the deliberate opposite, for watching an idle entry
   * actually go.
   */
  gcTime: GcTimeSetting;
};

export const initialOptions: LabOptions = {
  failure: "never",
  gcTime: "infinity",
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

/**
 * How long this card's value outlives the card. `lane` is the setting a read
 * does not make — it falls back to the instance policy in the options above.
 */
export type ReadGcTimeSetting = "lane" | "0" | "5s";

export const READ_GC_TIMES: Record<ReadGcTimeSetting, number | undefined> = {
  lane: undefined,
  "0": 0,
  "5s": 5_000,
};

/**
 * How long this card's value waits for a reader who never arrived — a card left
 * unmounted while its load was in flight. Short values are what make it
 * watchable at all; the lane's default is a minute.
 */
export type WarmTimeSetting = "lane" | "0" | "3s";

export const WARM_TIMES: Record<WarmTimeSetting, number | undefined> = {
  lane: undefined,
  "0": 0,
  "3s": 3_000,
};

/**
 * What the card does with a `error` — the field a failed refresh over
 * existing data comes back in.
 *
 * - `inline`: render the data *and* the error, which is what the docs ask for.
 * - `throw`: hand it to the boundary, losing the subtree. The axis exists to
 *   put a price on that, so the frame carries a text input: whatever is typed
 *   into it is the local state a throw destroys.
 */
export type ErrorMode = "inline" | "throw";

/** Two keys, so that "somebody else is reading this" is a thing you can arrange. */
export type LabKeyName = "A" | "B";

export const LAB_KEY_NAMES: readonly LabKeyName[] = ["A", "B"];

/**
 * Where `useLane` sits relative to the boundary — the axis the lab was built
 * for, because it decides what a throw takes with it.
 *
 * - `integrated`: `useLane` and `use` in one component, wholly under the
 *   boundary. The subscription unmounts with the reader that threw.
 * - `separated`: `useLane` above the boundary, the promise handed to a child
 *   that `use`s it. The throw takes the child; the subscription stays.
 */
export type VariationPattern = "integrated" | "separated";

/**
 * One card: an implementation pattern, a key, and the options its read is made
 * with. Everything here is a *reader's* decision, which is why it is per-card
 * rather than global — two cards on one key with different options is the
 * comparison this lab is for.
 *
 * Held above the world so Reload rebuilds the lane underneath the same set of
 * cards, `mounted` included: a run set up with one card unmounted is still that
 * run after a Reload.
 */
export type Variation = {
  id: number;
  pattern: VariationPattern;
  keyName: LabKeyName;
  mounted: boolean;
  /** What a remount of this card is served: what it left, or a fresh load. */
  gcTime: ReadGcTimeSetting;
  /** How long its value waits for it if it never arrives. */
  warmTime: WarmTimeSetting;
  error: ErrorMode;
  staleTime: StaleTimeSetting;
  /**
   * The revalidation triggers, a different mechanism from the two above: those
   * decide what a read does when it runs, these fire a refresh from an effect.
   * Both are gated by `staleTime` — a trigger refreshes only what is stale — so
   * with `staleTime: none` they are on and silent, and development says so.
   *
   * `refetchOnReconnect` is left out: it cannot be provoked by hand the way a
   * tab switch provokes focus.
   */
  refetchOnMount: boolean;
  refetchOnFocus: boolean;
};

let nextVariationId = 1;

export function createVariation(patch: Partial<Variation> = {}): Variation {
  return {
    id: nextVariationId++,
    pattern: "integrated",
    keyName: "A",
    mounted: true,
    gcTime: "lane",
    warmTime: "lane",
    error: "inline",
    staleTime: "none",
    refetchOnMount: false,
    refetchOnFocus: false,
    ...patch,
  };
}

export type LabRead = LaneReadSpec<string> & { key: LaneKeyOf<string> };

/**
 * Everything a run of the lab is: a lane, the reads it is exercised through,
 * and the instruments watching them. Built together and thrown away together,
 * because a first-load failure is only reachable from an empty store.
 */
export type LabWorld = {
  id: number;
  /** What it was built with, printed on it: the option can be changed, this cannot. */
  gcTime: GcTimeSetting;
  lane: Lane;
  reads: Record<LabKeyName, LabRead>;
  getCalls: (keyName: LabKeyName) => number;
  subscribeCalls: (listener: () => void) => () => void;
};

let nextWorldId = 1;

export function createWorld(getOptions: () => LabOptions): LabWorld {
  // Read once, now: a lane's GC policy is fixed when it is built, which is why
  // that switch asks for a Reload where the others take effect immediately.
  const gcTime = getOptions().gcTime;
  const lane = createLane({ gcTime: GC_TIMES[gcTime] });

  // The instrument: how many times each key's loader ran. It must never
  // subscribe to the lane — `onInvalidate` / `onRemove` listeners land in
  // `entry.subscribers`, the very gate this lab exists to observe, so an
  // instrument built on them would be blocking the path it is there to measure.
  // A counter and a store of its own cannot.
  const calls: Record<LabKeyName, number> = { A: 0, B: 0 };
  const listeners = new Set<() => void>();

  const readFor = (keyName: LabKeyName): LabRead => {
    const loader: LaneLoader<string> = async () => {
      calls[keyName] += 1;
      const version = `v${calls[keyName]}`;
      // Read once, here: flipping the switch while this call is in flight
      // decides the *next* call, not this one.
      const failing = getOptions().failure === "always";

      // The loader runs during a reader's render, so notifying synchronously
      // would be a store update in the middle of another component's render.
      // One tick is enough to put it after.
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener();
        }
      });

      // Fixed delay so the Suspense fallback is actually on screen long enough
      // to be seen, rather than inferred.
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (failing) {
        throw new Error(`loader ${keyName} ${version} failed`);
      }

      return version;
    };

    return laneRead({ key: ["lab", keyName], loader });
  };

  return {
    id: nextWorldId++,
    gcTime,
    lane,
    reads: { A: readFor("A"), B: readFor("B") },
    getCalls: (keyName) => calls[keyName],
    subscribeCalls: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
