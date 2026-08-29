/**
 * Lane measures elapsed cache lifetimes; it never needs calendar time.
 *
 * A monotonic clock cannot jump when the system clock changes, and unlike
 * `Date.now()` it does not make a pure React prerender depend on wall time.
 * Modern browsers, Node 20+, and current React Native runtimes provide it.
 */
export function elapsedNow(): number {
  return performance.now();
}
