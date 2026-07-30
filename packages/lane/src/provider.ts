"use client";

import * as React from "react";
import { createLane } from "./core";
import { domEventSource } from "./event-source";
import type { LaneEventSource } from "./event-source";
import type { Lane, LaneLoaderMeta, LaneLoaderMetaProp } from "./types";

// A reader's opt-in to activity-based revalidation. Focus / reconnect are DOM
// concerns the provider already owns (it holds the window listeners), so the
// registry of who wants them lives here — the store stays unaware of "focus".
// The provider fans its events out to the registered handlers; each one
// refreshes its own keys with a plain `invalidateEntry`.
export type Revalidator = {
  onFocus?: () => void;
  onReconnect?: () => void;
};

export type LaneRevalidation = {
  subscribe: (revalidator: Revalidator) => () => void;
};

// One context for everything the provider supplies: the store, its revalidation
// registry, and the loader meta. They share a provider and a lifetime and are
// always read together (a reader needs all three), so a single context models
// them more honestly than two — and since `revalidation` never changes, nothing
// consumes it in isolation that a split would spare a re-render.
type LaneContextValue = {
  lane: Lane;
  revalidation: LaneRevalidation;
  loaderMeta: LaneLoaderMeta;
  /**
   * What the nearest `LaneHydration` above published, keyed by key id. Carried on
   * this context rather than one of its own so a read pays no second lookup and
   * an app that never hydrates never loads the module that sets it.
   */
  published?: Map<string, Promise<unknown>>;
};

export const LaneContext = React.createContext<LaneContextValue | null>(null);

const DEFAULT_FOCUS_THROTTLE_INTERVAL = 5_000;

// The registry the provider keeps for its lifetime: `revalidators` is the live
// set the window listeners fan out to; `revalidation` is the stable `subscribe`
// handle handed to readers through context. Created once (see the ref below).
function createRegistry(): {
  revalidators: Set<Revalidator>;
  revalidation: LaneRevalidation;
} {
  const revalidators = new Set<Revalidator>();

  return {
    revalidators,
    revalidation: {
      subscribe(revalidator) {
        revalidators.add(revalidator);
        return () => {
          revalidators.delete(revalidator);
        };
      },
    },
  };
}

export type LaneProviderProps = {
  lane?: Lane;
  /**
   * Window focus and visibilitychange both fire on a tab switch. Focus
   * revalidations within this window are coalesced into one (default 5s).
   */
  focusThrottleInterval?: number;
  /**
   * Where focus / reconnect signals come from. Defaults to browser DOM events
   * (`domEventSource`), feature-detected so it safely no-ops off the web. Pass
   * `noopEventSource` for a CLI, `createReactNativeEventSource(...)` for React
   * Native, or your own {@link LaneEventSource}. Use a stable reference — it is
   * an effect dependency (the shipped sources are stable).
   */
  eventSource?: LaneEventSource;
  children: React.ReactNode;
} & LaneLoaderMetaProp;

export function LaneProvider({
  lane: providedLane,
  focusThrottleInterval = DEFAULT_FOCUS_THROTTLE_INTERVAL,
  eventSource = domEventSource,
  loaderMeta,
  children,
}: LaneProviderProps) {
  // Both are created once and never re-created, so they are refs, not state.
  // The default lane is built lazily — only when no lane is supplied.
  const defaultLaneRef = React.useRef<Lane>(undefined);
  const lane = providedLane ?? (defaultLaneRef.current ??= createLane());

  const registryRef = React.useRef<ReturnType<typeof createRegistry>>(undefined);
  const { revalidators, revalidation } = (registryRef.current ??= createRegistry());

  React.useEffect(() => {
    // Throttle focus here, not in the source: coalescing repeated focus signals
    // is policy that applies whatever the source (DOM, AppState, custom), so the
    // source emits raw signals and the provider owns the window. Reconnect is not
    // throttled. The source wires the environment and returns its own cleanup.
    let lastFocusAt = 0;

    const onFocus = () => {
      const now = Date.now();

      if (now - lastFocusAt < focusThrottleInterval) {
        return;
      }

      lastFocusAt = now;

      for (const revalidator of [...revalidators]) {
        revalidator.onFocus?.();
      }
    };

    const onReconnect = () => {
      for (const revalidator of [...revalidators]) {
        revalidator.onReconnect?.();
      }
    };

    return eventSource({ onFocus, onReconnect });
  }, [revalidators, focusThrottleInterval, eventSource]);

  // `revalidation` is stable, so this changes only when `lane` or the loader
  // meta does. A changed meta re-renders readers, which is what makes the *next*
  // read use it; reads already in flight keep the meta they started with, and
  // entries already loaded are not invalidated — see `LaneRegister`.
  const value = React.useMemo<LaneContextValue>(
    () => ({ lane, loaderMeta: loaderMeta as LaneLoaderMeta, revalidation }),
    [lane, loaderMeta, revalidation],
  );

  // React 19: render the context object directly as a provider (`.Provider` is
  // slated for deprecation).
  return React.createElement(LaneContext, { value }, children);
}

/**
 * Everything the provider supplies, in one context read. The read hooks need all
 * of it, so they call this once rather than composing the narrow hooks below —
 * three `useContext` calls and three copies of the "must be used within" message
 * for one lookup, and the message would name whichever narrow hook happened to
 * run first instead of the hook the caller wrote.
 *
 * Internal: the narrow hooks are the public surface.
 */
export function useLaneContext(hook: string): LaneContextValue {
  const value = React.useContext(LaneContext);

  if (!value) {
    throw new Error(`${hook} must be used within a LaneProvider`);
  }

  return value;
}

export function useLaneInstance(): Lane {
  return useLaneContext("useLaneInstance").lane;
}

export function useLaneRevalidation(): LaneRevalidation {
  return useLaneContext("useLaneRevalidation").revalidation;
}
