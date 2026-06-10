import { vi } from "vitest";
import { onInvalidate, onRemove } from "../core";
import { serializeKey } from "../keys";
import type { Lane, LaneEntryInfo, LaneKey } from "../types";

type TestSubscription = (entry: LaneEntryInfo) => void;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

export async function settlePromiseHandlers(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export function resetVitest(): void {
  vi.restoreAllMocks();
  vi.useRealTimers();
}

export function subscribeInvalidate(
  lane: Lane,
  key: LaneKey,
  listener: TestSubscription,
): () => void {
  return onInvalidate(lane, serializeKey(key), listener);
}

export function subscribeRemove(
  lane: Lane,
  key: LaneKey,
  listener: TestSubscription,
): () => void {
  return onRemove(lane, serializeKey(key), listener);
}
