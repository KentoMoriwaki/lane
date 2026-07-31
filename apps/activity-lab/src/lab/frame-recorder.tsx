"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

export type Frame = {
  t: number;
  text: string;
  display: string;
  flagged: boolean;
  /** How many consecutive captures (rAF or mutation) showed this exact frame. */
  count: number;
  /**
   * How many of those captures were rAF ticks. A frame with rafTicks 0 was
   * only ever seen by the MutationObserver — it was committed to the DOM but
   * no paint boundary sampled it, so it (almost certainly) never reached the
   * screen. This is the discriminator for "corrected before paint".
   */
  rafTicks: number;
};

export type FrameFlag = string | RegExp | ((frame: { text: string; display: string }) => boolean);

export type FrameRecorderOptions = {
  /** Frames matching this are highlighted red in `<FrameStrip>`. */
  flag?: FrameFlag;
  capacity?: number;
};

export type FrameRecorder = {
  subscribe(listener: () => void): () => void;
  frames(): readonly Frame[];
  clear(): void;
  setFlag(flag: FrameFlag | undefined): void;
};

const EMPTY: readonly Frame[] = [];

function createRecorder(options: FrameRecorderOptions): FrameRecorder & {
  attach(element: HTMLElement): () => void;
} {
  const capacity = options.capacity ?? 300;
  let flag = options.flag;
  let frames: Frame[] = [];
  let snapshot: readonly Frame[] = EMPTY;
  const listeners = new Set<() => void>();

  const isFlagged = (text: string, display: string): boolean => {
    if (flag === undefined) return false;
    if (typeof flag === "string") return text.includes(flag);
    if (flag instanceof RegExp) return flag.test(text);
    return flag({ text, display });
  };

  const notify = () => {
    snapshot = frames.slice();
    for (const listener of listeners) {
      listener();
    }
  };

  const capture = (element: HTMLElement, source: "raf" | "mutation") => {
    const text = element.textContent ?? "";
    // Activity hides a subtree by setting inline `display: none` on the
    // boundary's host children; the inline value is checked first so a strip
    // whose target is such a child records the hide, and the computed value
    // covers targets nested deeper.
    const display =
      element.style.display !== ""
        ? element.style.display
        : getComputedStyle(element).display;

    const last = frames.at(-1);
    if (last !== undefined && last.text === text && last.display === display) {
      last.count += 1;
      if (source === "raf") {
        last.rafTicks += 1;
      }
      return;
    }

    frames.push({
      t: performance.now(),
      text,
      display,
      flagged: isFlagged(text, display),
      count: 1,
      rafTicks: source === "raf" ? 1 : 0,
    });
    if (frames.length > capacity) {
      frames = frames.slice(frames.length - capacity);
    }
    notify();
  };

  return {
    attach(element: HTMLElement) {
      let raf = 0;
      const tick = () => {
        capture(element, "raf");
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      // A commit and its revert can both land between two rAF ticks; the
      // observer catches those sub-frame states the rAF loop would miss.
      // Note the observer reads the DOM at its microtask checkpoint, so a
      // state that is committed and corrected within one synchronous task is
      // invisible even here — absence of a frame is itself evidence.
      const observer = new MutationObserver(() => capture(element, "mutation"));
      observer.observe(element, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style"],
      });

      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    frames() {
      return snapshot;
    },
    clear() {
      frames = [];
      notify();
    },
    setFlag(next) {
      flag = next;
    },
  };
}

export function useFrameRecorder(
  ref: RefObject<HTMLElement | null>,
  options: FrameRecorderOptions = {},
): FrameRecorder {
  const [recorder] = useState(() => createRecorder(options));

  recorder.setFlag(options.flag);

  useEffect(() => {
    // The ref target may commit later than this effect: a subtree inside
    // <Activity> mounts in its own (deferred) pass, so an observer component
    // outside the boundary sees ref.current === null on its first effect.
    // Poll with rAF until the element exists instead of giving up.
    let cleanup: (() => void) | undefined;
    let raf = 0;
    const tryAttach = () => {
      const element = ref.current;
      if (element !== null) {
        cleanup = recorder.attach(element);
      } else {
        raf = requestAnimationFrame(tryAttach);
      }
    };
    tryAttach();

    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [recorder, ref]);

  return recorder;
}

export function FrameStrip({
  recorder,
  label,
}: {
  recorder: FrameRecorder;
  label?: string;
}) {
  const frames = useSyncExternalStore(
    recorder.subscribe,
    recorder.frames,
    () => EMPTY,
  );

  return (
    <div className="rounded border border-zinc-200 bg-white p-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{label ?? "frames"} ({frames.length})</span>
        <button
          type="button"
          onClick={() => recorder.clear()}
          className="rounded border border-zinc-200 px-1 hover:bg-zinc-100"
        >
          clear
        </button>
      </div>
      <div className="flex flex-wrap gap-px">
        {frames.map((frame, index) => (
          <span
            key={`${frame.t}-${index}`}
            title={`+${frame.t.toFixed(1)}ms x${frame.count} raf:${frame.rafTicks}\ndisplay:${frame.display}\n${frame.text}`}
            className={`h-4 min-w-1.5 cursor-help ${
              frame.display === "none"
                ? "bg-zinc-300"
                : frame.flagged
                  ? frame.rafTicks > 0
                    ? "bg-red-500"
                    : "bg-amber-400"
                  : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(24, 6 + Math.log2(frame.count) * 3)}px` }}
          />
        ))}
      </div>
      {frames.length > 0 && (
        <div className="mt-1 truncate font-mono text-[10px] text-zinc-600">
          last: {frames.at(-1)?.text}
        </div>
      )}
    </div>
  );
}
