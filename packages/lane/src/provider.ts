"use client";

import * as React from "react";
import { createLane, elapsedNow, setLaneRefresh } from "./core";
import { domEventSource } from "./event-source";
import type { LaneEventSource } from "./event-source";
import type { Lane, LaneLoaderMeta, LaneLoaderMetaProp } from "./types";

// A reader's opt-in to focus / reconnect revalidation. The registry lives in
// the provider, keeping the store unaware of "focus".
export type Revalidator = {
  onFocus?: () => void;
  onReconnect?: () => void;
};

export type LaneRevalidation = {
  subscribe: (revalidator: Revalidator) => () => void;
};

// One context for all three: they share a lifetime and are always read
// together, and `revalidation` never changes, so a split would spare nothing.
type LaneContextValue = {
  lane: Lane;
  revalidation: LaneRevalidation;
  loaderMeta: LaneLoaderMeta;
};

const LaneContext = React.createContext<LaneContextValue | null>(null);

const DEFAULT_FOCUS_THROTTLE_INTERVAL = 5_000;

// `revalidators` is the live set the source fans out to; `revalidation` the
// stable subscribe handle for readers.
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
   * Where focus / reconnect signals come from; defaults to `domEventSource`.
   * Pass `noopEventSource`, `createReactNativeEventSource(...)`, or your own
   * {@link LaneEventSource}. Use a stable reference — it is an effect
   * dependency (the shipped sources are stable).
   */
  eventSource?: LaneEventSource;
  /**
   * How Lane asks the owner of an external key to publish it again —
   * `() => router.refresh()` in Next's App Router,
   * `() => revalidator.revalidate()` in React Router's data mode. Installed on
   * the lane below, so this and `createLane({ refresh })` are the same setting;
   * the provider wins for a lane it is given. See {@link LaneOptions.refresh}
   * for when it is called.
   */
  refresh?: () => void;
  children: React.ReactNode;
} & LaneLoaderMetaProp;

export function LaneProvider({
  lane: providedLane,
  focusThrottleInterval = DEFAULT_FOCUS_THROTTLE_INTERVAL,
  eventSource = domEventSource,
  loaderMeta,
  refresh,
  children,
}: LaneProviderProps) {
  // Both created once, never re-created: refs, not state.
  const defaultLaneRef = React.useRef<Lane>(undefined);
  const lane = providedLane ?? (defaultLaneRef.current ??= createLane());

  // The ask is the lane's, not a reader's — one pending flag per lane, fired
  // from the store's read path — so the prop is installed on the lane rather
  // than carried in the context below. Written during render, and deliberately:
  // a read runs during render too, and the first one of a revealed subtree must
  // find the ask already there. Idempotent, so a discarded or double render
  // writes the same thing. Only when given: an absent prop means "the lane
  // keeps what `createLane` gave it", not "unset it", so the two ways of
  // supplying a `refresh` compose. A lane handed to two providers that both
  // supply one takes the last to render — give a shared lane its `refresh` at
  // `createLane` instead.
  if (refresh !== undefined) {
    // oxlint-disable-next-line react/react-compiler
    setLaneRefresh(lane, refresh);
  }

  const registryRef = React.useRef<ReturnType<typeof createRegistry>>(undefined);
  const { revalidators, revalidation } = (registryRef.current ??= createRegistry());

  React.useEffect(() => {
    // Focus is throttled here, not in the source: coalescing is policy that
    // applies whatever the source. Reconnect is not throttled.
    // A monotonic clock starts near zero, so zero itself cannot mean "never" —
    // the first focus must always pass regardless of the runtime's time origin.
    let lastFocusAt = Number.NEGATIVE_INFINITY;

    const onFocus = () => {
      const now = elapsedNow();

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

  // A changed meta re-renders readers, so the *next* read uses it; in-flight
  // reads keep theirs, and loaded entries are not invalidated (see `LaneRegister`).
  const value = React.useMemo<LaneContextValue>(
    () => ({ lane, loaderMeta: loaderMeta as LaneLoaderMeta, revalidation }),
    [lane, loaderMeta, revalidation],
  );

  // React 19: context object as provider (`.Provider` is slated for deprecation).
  return React.createElement(LaneContext, { value }, children);
}

/**
 * Everything the provider supplies, in one context read; `hook` names the
 * caller in the error. Internal: the narrow hooks below are the public surface.
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
