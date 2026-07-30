"use client";

import * as React from "react";
import { createLane } from "./core";
import { domEventSource } from "./event-source";
import type { LaneEventSource } from "./event-source";
import type { Lane, LaneUseOptions } from "./types";

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
  defaults,
  focusThrottleInterval = DEFAULT_FOCUS_THROTTLE_INTERVAL,
  eventSource = domEventSource,
  children,
}: {
  lane?: Lane;
  /**
   * App-wide fallbacks for every read option, for the lane this provider creates
   * — the usual way to set them, because letting the provider own the lane is
   * the usual way to hold one. A module-level `createLane()` is shared by every
   * request on the server; the provider's is created per render, so it is
   * request-scoped for free.
   *
   * They are forwarded into that `createLane()` rather than published through
   * context, which is what keeps them reachable from a `lane.prefetch` in an
   * event handler or a router loader: the defaults live on the instance, the
   * prop is only where you write them.
   *
   * Read once, when the provider creates its lane. A later change is ignored,
   * matching `createLane({ defaults })` — a default is read when a load starts
   * and when a trigger fires, and could never reach a promise already cached.
   * Pass options at the read for policy that varies at runtime.
   *
   * Mutually exclusive with `lane`: a lane you created carries its own defaults
   * (`createLane({ defaults })`), and a provider cannot add to them without
   * either mutating a shared instance or making a subtree disagree with the
   * instance every non-React path reads. Passing both throws.
   */
  defaults?: LaneUseOptions;
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
}) {
  if (providedLane && defaults) {
    throw new Error(
      "LaneProvider: pass `defaults` or `lane`, not both — put them on the lane you created: createLane({ defaults })",
    );
  }

  // Both are created once and never re-created, so they are refs, not state.
  // The default lane is built lazily — only when no lane is supplied — and takes
  // the `defaults` prop with it, so they end up on the instance exactly as
  // `createLane({ defaults })` puts them there. Read once, with the lane.
  const defaultLaneRef = React.useRef<Lane>(undefined);
  const lane =
    providedLane ?? (defaultLaneRef.current ??= createLane({ defaults }));

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
