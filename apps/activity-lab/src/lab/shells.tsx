"use client";

import {
  Activity,
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { labLog } from "./log";

export type LabVisibility = "visible" | "hidden" | "unknown";

// Default "unknown" is the Next.js constraint itself: a subtree inside the
// router's bfcache Activity has no way to ask whether it is hidden. The
// instrumented shell is what a cooperating router could provide instead.
const VisibilityContext = createContext<LabVisibility>("unknown");

export function useLabVisibility(): LabVisibility {
  return useContext(VisibilityContext);
}

export type LabActivityProps = {
  mode: "visible" | "hidden";
  variant?: "opaque" | "instrumented";
  /** When set, mode changes are logged to this channel as `activity` events. */
  channel?: string;
  children: ReactNode;
};

export function LabActivity({
  mode,
  variant = "opaque",
  channel,
  children,
}: LabActivityProps) {
  useEffect(() => {
    if (channel !== undefined) {
      labLog.push(channel, "activity", `mode=${mode} variant=${variant}`);
    }
  }, [channel, mode, variant]);

  const activity = <Activity mode={mode}>{children}</Activity>;

  if (variant === "opaque") {
    return activity;
  }

  return (
    <VisibilityContext.Provider value={mode}>
      {activity}
    </VisibilityContext.Provider>
  );
}
