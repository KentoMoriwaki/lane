"use client";

import { useCallback, useEffect, useState } from "react";
import { setTransportKnobs } from "./feed-client";
import { DEFAULT_SETTINGS, type LabSettings } from "./types";

/**
 * Lab settings state, shared so that every variant runs under identical
 * conditions and the transport knobs are applied the same way — that is a
 * property of the measurement, not of any library.
 *
 * It hands back a plain state object and an updater. What a variant does with
 * them is entirely its own business.
 */
export function useLabSettings(): {
  settings: LabSettings;
  update: (patch: Partial<LabSettings>) => void;
} {
  const [settings, setSettings] = useState<LabSettings>(DEFAULT_SETTINGS);

  // `feed-client` starts with the same defaults as `DEFAULT_SETTINGS`, so the
  // first request already uses the right knobs; this keeps them in sync after.
  useEffect(() => {
    setTransportKnobs({
      latencyMs: settings.latencyMs,
      failAt: settings.failAt,
    });
  }, [settings.latencyMs, settings.failAt]);

  const update = useCallback((patch: Partial<LabSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return { settings, update };
}
