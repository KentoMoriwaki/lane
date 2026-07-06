"use client";

import * as React from "react";
import { createLane } from "./core";
import type { Lane } from "./types";

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

// One context for everything the provider supplies: the store and its
// revalidation registry. They share a provider and a lifetime and are always
// read together (a reader needs both), so a single context models them more
// honestly than two — and since `revalidation` never changes, nothing consumes
// it in isolation that a split would spare a re-render.
type LaneContextValue = {
  lane: Lane;
  revalidation: LaneRevalidation;
};

const LaneContext = React.createContext<LaneContextValue | null>(null);

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

export function LaneProvider({
  lane: providedLane,
  focusThrottleInterval = DEFAULT_FOCUS_THROTTLE_INTERVAL,
  children,
}: {
  lane?: Lane;
  /**
   * Window focus and visibilitychange both fire on a tab switch. Focus
   * revalidations within this window are coalesced into one (default 5s).
   */
  focusThrottleInterval?: number;
  children: React.ReactNode;
}) {
  // Both are created once and never re-created, so they are refs, not state.
  // The default lane is built lazily — only when no lane is supplied.
  const defaultLaneRef = React.useRef<Lane>(undefined);
  const lane = providedLane ?? (defaultLaneRef.current ??= createLane());

  const registryRef = React.useRef<ReturnType<typeof createRegistry>>(undefined);
  const { revalidators, revalidation } = (registryRef.current ??= createRegistry());

  React.useEffect(() => {
    let lastFocusAt = 0;

    const fireFocus = () => {
      const now = Date.now();

      if (now - lastFocusAt < focusThrottleInterval) {
        return;
      }

      lastFocusAt = now;

      for (const revalidator of [...revalidators]) {
        revalidator.onFocus?.();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fireFocus();
      }
    };

    const fireReconnect = () => {
      for (const revalidator of [...revalidators]) {
        revalidator.onReconnect?.();
      }
    };

    window.addEventListener("focus", fireFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", fireReconnect);

    return () => {
      window.removeEventListener("focus", fireFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", fireReconnect);
    };
  }, [revalidators, focusThrottleInterval]);

  // `revalidation` is stable, so this changes only when `lane` does.
  const value = React.useMemo<LaneContextValue>(
    () => ({ lane, revalidation }),
    [lane, revalidation],
  );

  // React 19: render the context object directly as a provider (`.Provider` is
  // slated for deprecation).
  return React.createElement(LaneContext, { value }, children);
}

// Both hooks require the provider; the caller name keeps the error specific.
function useLaneContext(hook: string): LaneContextValue {
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
