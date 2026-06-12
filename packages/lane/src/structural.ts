import { isPlainObject } from "./keys";

/**
 * Builds the next value while reusing every subtree of the previous value
 * that is deeply equal. Keeping referential identity for unchanged data lets
 * memoized consumers skip re-rendering after a refetch returns the same data.
 */
export function replaceEqualDeep<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) {
    return prev as T;
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    const merged = next.map((item, index) => replaceEqualDeep(prev[index], item));
    const equal =
      prev.length === next.length &&
      merged.every((item, index) => item === prev[index]);

    return (equal ? prev : merged) as T;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevRecord = prev as Record<string, unknown>;
    const nextRecord = next as Record<string, unknown>;
    const nextKeys = Object.keys(nextRecord);
    const merged: Record<string, unknown> = {};
    let reusedCount = 0;

    for (const key of nextKeys) {
      const value = replaceEqualDeep(prevRecord[key], nextRecord[key]);
      merged[key] = value;

      if (key in prevRecord && value === prevRecord[key]) {
        reusedCount += 1;
      }
    }

    const equal =
      Object.keys(prevRecord).length === nextKeys.length &&
      reusedCount === nextKeys.length;

    return (equal ? prev : merged) as T;
  }

  return next;
}
