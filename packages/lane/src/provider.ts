"use client";

import * as React from "react";
import { createLane, refetchOnFocus } from "./core";
import type { Lane } from "./types";

const LaneContext = React.createContext<Lane | null>(null);

export function LaneProvider({
  lane: providedLane,
  children,
}: {
  lane?: Lane;
  children: React.ReactNode;
}) {
  const [defaultLane] = React.useState(() => createLane());
  const lane = providedLane ?? defaultLane;

  React.useEffect(() => {
    const handleFocus = () => {
      refetchOnFocus(lane);
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [lane]);

  return React.createElement(LaneContext.Provider, { value: lane }, children);
}

export function useLaneInstance(): Lane {
  const lane = React.useContext(LaneContext);

  if (!lane) {
    throw new Error("useLaneInstance must be used within a LaneProvider");
  }

  return lane;
}
