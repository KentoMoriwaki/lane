"use client";

import * as React from "react";
import { createLane, refetchOnFocus, refetchOnReconnect } from "./core";
import type { Lane } from "./types";

const LaneContext = React.createContext<Lane | null>(null);

const DEFAULT_FOCUS_THROTTLE_INTERVAL = 5_000;

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
  const [defaultLane] = React.useState(() => createLane());
  const lane = providedLane ?? defaultLane;

  React.useEffect(() => {
    let lastFocusAt = 0;

    const revalidateOnFocus = () => {
      const now = Date.now();

      if (now - lastFocusAt < focusThrottleInterval) {
        return;
      }

      lastFocusAt = now;
      refetchOnFocus(lane);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        revalidateOnFocus();
      }
    };

    const handleOnline = () => {
      refetchOnReconnect(lane);
    };

    window.addEventListener("focus", revalidateOnFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("focus", revalidateOnFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [lane, focusThrottleInterval]);

  return React.createElement(LaneContext.Provider, { value: lane }, children);
}

export function useLaneInstance(): Lane {
  const lane = React.useContext(LaneContext);

  if (!lane) {
    throw new Error("useLaneInstance must be used within a LaneProvider");
  }

  return lane;
}
