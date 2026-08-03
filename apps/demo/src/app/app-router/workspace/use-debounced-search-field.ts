"use client";

import * as React from "react";

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
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => void;
};

/**
 * Keep the URL as committed truth while preserving typed/IME text across the
 * debounce and an in-flight navigation. Superseded waits abort without turning
 * into application errors; URL writes merge at commit time in useWorkspaceUrl.
 */
export function useDebouncedSearchField(
  committed: string,
  commit: (value: string) => void,
  delay = 300,
): SearchField {
  const [value, setValue] = React.useOptimistic(
    committed,
    (_current, next: string) => next,
  );
  const pending = React.useRef<AbortController | null>(null);

  React.useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );

  const schedule = React.useCallback(
    (next: string) => {
      const previous = pending.current;
      const controller = new AbortController();
      pending.current = controller;

      React.startTransition(async () => {
        setValue(next);
        await sleep(delay, controller.signal);
        if (!controller.signal.aborted) commit(next);
      });

      previous?.abort();
    },
    [commit, delay, setValue],
  );

  return {
    value,
    onChange: (event) => schedule(event.target.value),
    onCompositionEnd: (event) => schedule(event.currentTarget.value),
  };
}
