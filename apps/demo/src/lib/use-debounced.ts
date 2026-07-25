"use client";

import * as React from "react";

/**
 * Trailing debounce: returns `value` only after it has stayed unchanged for
 * `delayMs`. Each change re-arms the timer, so a burst of updates collapses to
 * the final value.
 *
 * `value` must be a primitive or a referentially stable object — a fresh object
 * every render re-arms the timer forever and never settles. For a derived
 * object, debounce a serialized/memoized form instead.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
