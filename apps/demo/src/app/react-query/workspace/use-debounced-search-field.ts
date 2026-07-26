"use client";

import * as React from "react";

/**
 * Debounced search field backed by `useOptimistic`.
 *
 * The URL stays the source of truth for the committed query; the optimistic
 * overlay is only what the user sees while the debounce and the URL write are
 * still in flight. Two details are load-bearing:
 *
 * - The delay is awaited *inside* the transition. An optimistic value survives
 *   only while a transition is pending, so a timer started outside of one would
 *   let the field snap back to the committed value between keystrokes.
 * - The round trip through the URL must be lossless (`url-state.ts` no longer
 *   trims `q`; the fetch layer trims instead). If the committed value differed
 *   from what was typed, the controlled input would be rewritten when the
 *   transition settles — which is what destroys an in-flight IME composition.
 *
 * Because the round trip is lossless, composition needs no special casing:
 * intermediate kana are perfectly good search prefixes, and committing them
 * keeps Japanese input as responsive as ASCII input.
 */

/**
 * Resolves on abort rather than rejecting: a rejection inside a transition
 * would surface as a real error, and "superseded by a newer keystroke" is not
 * one. Callers check `signal.aborted` after awaiting.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export type SearchField = {
  value: string;
  /** Drops a scheduled commit; the field falls back to the committed value. */
  cancel: () => void;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => void;
};

export function useDebouncedSearchField(
  committed: string,
  commit: (value: string) => void,
  delay = 300,
): SearchField {
  const [value, setValue] = React.useOptimistic(
    committed,
    (_current, next: string) => next,
  );

  // Only ever touched from event handlers and async continuations — never read
  // or written during render, where a discarded or replayed render could leave
  // it pointing at a controller that was never used.
  const pending = React.useRef<AbortController | null>(null);

  const cancel = React.useCallback(() => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  React.useEffect(() => cancel, [cancel]);

  const schedule = React.useCallback(
    (next: string) => {
      const previous = pending.current;
      const controller = new AbortController();
      pending.current = controller;

      React.startTransition(async () => {
        setValue(next);
        await sleep(delay, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        commit(next);
      });

      // Make the new transition pending before folding the old one. In the
      // other order there is an instant with no pending transition, and the
      // optimistic value would be dropped for that render.
      previous?.abort();
    },
    [commit, delay, setValue],
  );

  return {
    value,
    cancel,
    onChange: (event) => schedule(event.target.value),
    // Fallback for browsers that do not fire `input` after `compositionend`;
    // without it the last scheduled commit would carry the pre-conversion
    // reading instead of the converted text. When both events fire, the second
    // schedule simply aborts the first.
    onCompositionEnd: (event) => schedule(event.currentTarget.value),
  };
}
