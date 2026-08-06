// @vitest-environment jsdom

/**
 * Characterization tests for cross-reader consistency.
 *
 * Lane keeps each key's promise in `useState` + `useTransition` rather than in a
 * `useSyncExternalStore` read, so it converges readers *after* a commit instead
 * of preventing an inconsistent one. These tests pin down where that is
 * observable and — just as importantly — where it is not, so a later change to
 * the convergence logic shows up as a diff here.
 *
 * Tearing needs three things at once:
 *   1. a render-phase read (a fresh mount, or a key / lane / enabled switch),
 *   2. a promise React can read *synchronously* at that moment (nothing suspends),
 *   3. a transition on the same key that cannot commit yet.
 *
 * Condition 2 is the strong one. `use()` tags a thenable on first use and throws,
 * so even a store-settled promise suspends the first reader that touches it —
 * which routes the update through Suspense, where a transition holds the previous
 * screen. Condition 3 therefore has to come from somewhere *else* being stuck;
 * a plain "invalidate -> refetch" cannot produce it on its own.
 *
 * Assertions run against a log of committed DOM snapshots (`useFrames`), not just
 * the final state: a torn frame repaired one commit later is still a torn frame.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLane } from "../index";
import type { Lane, LaneKey, LaneLoader } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

const KEY: LaneKey = ["k"];
const BLOCKER: LaneKey = ["blocker"];
const OTHER: LaneKey = ["other"];

const roots: Root[] = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }

  document.body.innerHTML = "";
  resetVitest();
});

describe("cross-reader consistency", () => {
  describe("what protects readers", () => {
    it("converges subscribed readers of one key in a single commit", async () => {
      // `notifyInvalidate` fans out synchronously, so every subscriber's
      // `startTransition` runs in the same tick and shares React's per-event
      // transition lane. No committed frame may show them disagreeing.
      const lane = createLane();
      lane.set(KEY, "v1");

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "A", frames, key: "A" }),
          el(Reader, { id: "B", frames, key: "B" }),
        ])),
      );

      await settle(app);
      expect(text(app)).toBe("[A=v1][B=v1]");

      frames.list.length = 0;
      await act(async () => {
        lane.set(KEY, "v2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=v2][B=v2]");
      expect(tornFrames(frames)).toEqual([]);
    });

    it("never pins an uncommitted mount to a superseded promise", async () => {
      // A suspended fiber has not committed, so React re-runs its `useState`
      // initializer on every retry. Whatever the store holds at the last retry
      // wins — a mount cannot be stuck on a promise the store has moved past.
      const lane = createLane();
      const first = deferred<string>();
      const loader = vi.fn(() => first.promise);

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "A", frames, loader, key: "A" }),
        ])),
      );

      expect(text(app)).toBe("boot");

      // The reader is suspended and therefore not subscribed: this reaches no
      // subscriber, it only replaces what the store holds.
      await act(async () => {
        lane.set(KEY, "published");
        await settlePromiseHandlers();
      });

      // Settling the original read is what pings the boundary. The reader
      // re-reads on that retry instead of rendering the value it suspended on.
      await act(async () => {
        first.resolve("superseded");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=published]");
      expect(frames.list.some((frame) => frame.includes("superseded"))).toBe(false);
    });

    it("absorbs a store write landing between two render-phase reads", async () => {
      // The classic interleave: two siblings read in one pass and the store
      // changes between them. `Interleave` reproduces it deterministically by
      // writing from a sibling's render body (production equivalent: a timer or
      // WebSocket firing while React is yielded mid-render).
      //
      // It does not tear, and the reason is condition 2. The promise `set`
      // stores is settled as far as the store is concerned, but React has never
      // seen it, so the second reader's `use()` suspends and shows a fallback
      // rather than a value. If a future change ever hands render-phase reads a
      // synchronously-readable promise, this test is where it surfaces.
      const lane = createLane({ gcTime: Infinity });
      lane.set(KEY, "v1");

      // Warm-up mount so React tags v1's promise as fulfilled — without this the
      // first reader suspends too and there is no interleave to speak of.
      const warm = newFrames();
      const warmApp = await render(warm, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "A", frames: warm, key: "A" }),
        ])),
      );
      await settle(warmApp);
      expect(text(warmApp)).toBe("[A=v1]");
      unmount(warmApp);

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, [
          boundary("B:loading", [el(Reader, { id: "A", frames, key: "A" })], "ba"),
          el(Interleave, { lane, key: "mut" }),
          boundary("B:loading", [el(Reader, { id: "B", frames, key: "B" })], "bb"),
        ]),
      );
      await settle(app);

      expect(text(app)).toBe("[A=v2][B=v2]");
      expect(tornFrames(frames)).toEqual([]);
      // What the reader that read v2 actually showed in the meantime was its
      // fallback — a loading state beside a stale value, never a second value.
      //
      // Two frames rather than three, and that is the reconciliation being the
      // *only* correction A schedules. It used to be followed by a passive
      // catch-up that re-read the store and set the same promise again at
      // transition priority, which gave A's root a second lane and a retry of
      // its own: A came back from its fallback one commit ahead of B's first
      // paint. With the subscription opened in the layout phase there is nothing
      // left for that catch-up to find, and the two boundaries wake together.
      expect(frames.list).toEqual(["[A=v1]B:loading", "[A=v2][B=v2]"]);
    });

    it("does not tear when the transition only waits on its own key", async () => {
      // The urgent mount is still there — what is missing is a *second* thing
      // holding the transition back. Every reader ends up waiting on the one
      // pending promise, so they wake together. This is the ordinary
      // "invalidate -> refetch" shape, and it is safe on its own: mixing
      // priorities is necessary for a tear but not sufficient.
      const lane = createLane();
      const slow = deferred<string>();
      lane.set(KEY, "v1");
      lane.set(BLOCKER, "b1");
      lane.set(OTHER, "o1");

      const frames = newFrames();
      const ctl: Controls = {};
      const app = await render(frames, () =>
        el(MixedPriorityApp, { lane, frames, ctl, mode: "urgent-mount-unblocked" }),
      );

      await settle(app);
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1]");

      frames.list.length = 0;
      await act(async () => {
        ctl.run?.(slow.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // The urgent mount suspends on the very promise the transition is waiting
      // for, so it shows a fallback rather than a second value.
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1][C:loading]");
      expect(tornFrames(frames)).toEqual([]);

      await act(async () => {
        slow.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=v2][B=v2][X~b1][D~o1][C=v2]");
      expect(frames.list).toEqual([
        "[A=v1][B=v1][X~b1][D~o1][C:loading]",
        "[A=v2][B=v2][X~b1][D~o1][C=v2]",
      ]);
      expect(tornFrames(frames)).toEqual([]);
    });

    it("does not tear when the new reader mounts inside the same transition", async () => {
      // The control for the torn cases below. The mount and the store write are
      // one transition, so React holds the previous screen until the whole thing
      // can commit at once.
      const lane = createLane();
      const blocker = deferred<string>();
      lane.set(KEY, "v1");
      lane.set(BLOCKER, "b1");
      lane.set(OTHER, "o1");

      const frames = newFrames();
      const ctl: Controls = {};
      const app = await render(frames, () =>
        el(MixedPriorityApp, { lane, frames, ctl, mode: "transition-mount" }),
      );

      await settle(app);
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1]");

      frames.list.length = 0;
      await act(async () => {
        ctl.run?.(blocker.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // The transition is stuck on the blocker, so nothing moved at all.
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1]");
      expect(tornFrames(frames)).toEqual([]);

      await act(async () => {
        blocker.resolve("b2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=v2][B=v2][X~b2][D~o1][C=v2]");
      expect(tornFrames(frames)).toEqual([]);
    });
  });

  describe("an urgent render-phase read beside a transition that cannot commit", () => {
    it("tears on a fresh mount, for as long as the transition stays blocked", async () => {
      // The mount is urgent; the store write is inside a transition that a
      // second, still-loading key holds back. The urgent render reads straight
      // from the store, so the new reader ends up on v2 while the mounted
      // readers are still on v1 — and stays there until the blocker resolves.
      const lane = createLane();
      const blocker = deferred<string>();
      lane.set(KEY, "v1");
      lane.set(BLOCKER, "b1");
      lane.set(OTHER, "o1");

      const frames = newFrames();
      const ctl: Controls = {};
      const app = await render(frames, () =>
        el(MixedPriorityApp, { lane, frames, ctl, mode: "urgent-mount" }),
      );

      await settle(app);
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1]");

      frames.list.length = 0;
      await act(async () => {
        ctl.run?.(blocker.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // The urgent mount suspends once on the untagged promise (its own
      // boundary, so A/B are untouched), then commits v2 on the retry.
      expect(frames.list).toEqual([
        "[A=v1][B=v1][X~b1][D~o1][C:loading]",
        "[A=v1][B=v1][X~b1][D~o1][C=v2]",
      ]);
      // TORN: one key, two values on screen at the same time.
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1][C=v2]");
      expect(tornFrames(frames)).toContain("[A=v1][B=v1][X~b1][D~o1][C=v2]");

      // Not a one-frame glitch: nothing converges while the unrelated blocker
      // is in flight, so this is on screen for the whole fetch.
      await act(async () => {
        await settlePromiseHandlers();
        await settlePromiseHandlers();
      });
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1][C=v2]");

      await act(async () => {
        blocker.resolve("b2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=v2][B=v2][X~b2][D~o1][C=v2]");
    });

    it("tears the same way on an urgent key switch", async () => {
      // Condition 1's other half: the render-phase read in the source-change
      // branch of `useLane`, not a fresh mount. A reader switching its key onto
      // KEY reads the store directly and lands on v2 ahead of the transition.
      const lane = createLane();
      const blocker = deferred<string>();
      lane.set(KEY, "v1");
      lane.set(BLOCKER, "b1");
      lane.set(OTHER, "o1");

      const frames = newFrames();
      const ctl: Controls = {};
      const app = await render(frames, () =>
        el(MixedPriorityApp, { lane, frames, ctl, mode: "urgent-switch" }),
      );

      await settle(app);
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D~o1]");

      frames.list.length = 0;
      await act(async () => {
        ctl.run?.(blocker.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // Frame 1 keeps D's previous subtree in the DOM beside its fallback,
      // which is how React hides content it may still restore.
      expect(frames.list).toEqual([
        "[A=v1][B=v1][X~b1][D~o1][D:loading]",
        "[A=v1][B=v1][X~b1][D=v2]",
      ]);
      // TORN: D switched onto KEY and shows v2 while A and B still show v1.
      expect(text(app)).toBe("[A=v1][B=v1][X~b1][D=v2]");
      expect(tornFrames(frames)).toContain("[A=v1][B=v1][X~b1][D=v2]");

      await act(async () => {
        blocker.resolve("b2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=v2][B=v2][X~b2][D=v2]");
    });
  });

  describe("pending flags", () => {
    it("joins the transition of the notification, whenever it arrives", async () => {
      // `Invalidate` fires from a mount effect placed between the two readers,
      // so it lands after one of them has finished mounting and while the other
      // still has passive effects to run. Both are subscribed by then — that
      // happens in the layout phase — so both are notified directly and converge
      // on the same update, which means both must report the same pending flag.
      // A reader that had to work out afterwards *that* something changed could
      // only guess at *which* transition asked for it, and would report the
      // background flag against its sibling's explicit one.
      const lane = createLane({ gcTime: Infinity });
      const reload = deferred<string>();
      const loader = vi.fn(() => reload.promise);
      lane.set(KEY, "v1");

      // Warm-up so React has tagged v1's promise: without it both readers
      // suspend, never commit, and no effect runs at all.
      const warm = newFrames();
      const warmApp = await render(warm, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "A", frames: warm, loader, key: "A" }),
        ])),
      );
      await settle(warmApp);
      unmount(warmApp);

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "B", frames, flags: true, loader, key: "B" }),
          el(Invalidate, { lane, key: "inv" }),
          el(Reader, { id: "A", frames, flags: true, loader, key: "A" }),
        ])),
      );
      await settle(app);

      // Both are in the same explicit transition, not one of each.
      expect(text(app)).toBe("[B=v1:t1b0][A=v1:t1b0]");

      await act(async () => {
        reload.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[B=v2:t0b0][A=v2:t0b0]");
      expect(tornFrames(frames)).toEqual([]);
    });

    it("stays in the background for a background notification", async () => {
      // The same shape with the other source — a background refresh must not be
      // promoted into the flag a user action raises.
      const lane = createLane({ gcTime: Infinity });
      const reload = deferred<string>();
      const loader = vi.fn(() => reload.promise);
      lane.set(KEY, "v1");

      const warm = newFrames();
      const warmApp = await render(warm, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "A", frames: warm, loader, key: "A" }),
        ])),
      );
      await settle(warmApp);
      unmount(warmApp);

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "B", frames, flags: true, loader, key: "B" }),
          el(Invalidate, { lane, background: true, key: "inv" }),
          el(Reader, { id: "A", frames, flags: true, loader, key: "A" }),
        ])),
      );
      await settle(app);

      expect(text(app)).toBe("[B=v1:t0b1][A=v1:t0b1]");

      await act(async () => {
        reload.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[B=v2:t0b0][A=v2:t0b0]");
    });

    it("receives a notification landing in its own commit's layout phase", async () => {
      // The window a reader used to be blind in: after its reconciliation has
      // read the store and before its passive effects run. `LayoutInvalidate`
      // sits in it by construction — a layout effect ordered after the mounting
      // reader's — and nothing the store keeps afterwards says which transition
      // that invalidation asked for. A is subscribed one line before it fires,
      // so it takes the notification in the same tick as B, which mounted a
      // commit ago. Agreement here is the notification having been received
      // rather than reconstructed.
      const lane = createLane({ gcTime: Infinity });
      const reload = deferred<string>();
      const loader = vi.fn(() => reload.promise);
      lane.set(KEY, "v1");

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "B", frames, flags: true, loader, key: "B" }),
        ])),
      );
      await settle(app);
      expect(text(app)).toBe("[B=v1:t0b0]");

      await rerender(app, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "B", frames, flags: true, loader, key: "B" }),
          el(Reader, { id: "A", frames, flags: true, loader, key: "A" }),
          el(LayoutInvalidate, { lane, key: "inv" }),
        ])),
      );
      await settle(app);

      expect(text(app)).toBe("[B=v1:t1b0][A=v1:t1b0]");
      expect(loader).toHaveBeenCalledTimes(1);

      await act(async () => {
        reload.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[B=v2:t0b0][A=v2:t0b0]");
      expect(tornFrames(frames)).toEqual([]);
    });
  });

  describe("pending window", () => {
    it("leaves every reader unaware while an awaited action runs", async () => {
      // `startTransition(async () => { await action(); invalidate() })` cannot
      // signal anything before the action settles: notification is the only
      // channel and it fires last. No reader shows a pending flag until then.
      const lane = createLane();
      const action = deferred<void>();
      const reload = deferred<string>();
      const loader = vi.fn(() => reload.promise);
      lane.set(KEY, "v1");

      const frames = newFrames();
      const ctl: Controls = {};
      const app = await render(frames, () =>
        el(ActionApp, { lane, frames, ctl, loader }),
      );
      await settle(app);
      expect(text(app)).toBe("[A=v1:t0b0][B=v1:t0b0]");

      await act(async () => {
        ctl.act?.(action.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // The action is in flight and nothing on screen reflects it.
      expect(text(app)).toBe("[A=v1:t0b0][B=v1:t0b0]");
      expect(loader).not.toHaveBeenCalled();

      await act(async () => {
        action.resolve();
        await settlePromiseHandlers();
      });
      await settle(app);

      // Pending only starts here — delayed by the entire action duration.
      expect(text(app)).toBe("[A=v1:t1b0][B=v1:t1b0]");
      expect(loader).toHaveBeenCalledTimes(1);

      await act(async () => {
        reload.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);
      expect(text(app)).toBe("[A=v2:t0b0][B=v2:t0b0]");
    });

    it("closes the window with startInvalidationTransition", async () => {
      // The general fix: the readers are put in the action's transition when it
      // starts, so pending covers the whole action even though the action does
      // not resolve to this key's value.
      const lane = createLane();
      const action = deferred<void>();
      const reload = deferred<string>();
      const loader = vi.fn(() => reload.promise);
      lane.set(KEY, "v1");

      const frames = newFrames();
      const ctl: Controls = {};
      const app = await render(frames, () =>
        el(ActionApp, { lane, frames, ctl, loader, announce: true }),
      );
      await settle(app);
      expect(text(app)).toBe("[A=v1:t0b0][B=v1:t0b0]");

      await act(async () => {
        ctl.act?.(action.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // Pending from the start, previous value still on screen, and no fetch has
      // gone out yet — the read is waiting behind the action.
      expect(text(app)).toBe("[A=v1:t1b0][B=v1:t1b0]");
      expect(loader).not.toHaveBeenCalled();

      await act(async () => {
        action.resolve();
        await settlePromiseHandlers();
      });
      await settle(app);

      // Still pending across the hand-off: the fetch starts where the action ends.
      expect(text(app)).toBe("[A=v1:t1b0][B=v1:t1b0]");
      expect(loader).toHaveBeenCalledTimes(1);

      await act(async () => {
        reload.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);

      expect(text(app)).toBe("[A=v2:t0b0][B=v2:t0b0]");
      // Exactly one pending stretch, from the click to the fresh data — no blink
      // where pending drops at the hand-off from the action to the fetch.
      expect(frames.list).toEqual([
        "[A=v1:t0b0][B=v1:t0b0]",
        "[A=v1:t1b0][B=v1:t1b0]",
        "[A=v2:t0b0][B=v2:t0b0]",
      ]);
      expect(tornFrames(frames)).toEqual([]);
    });

    it("publishing the in-flight promise marks every reader pending at once", async () => {
      // The workaround available today: `set` stores the in-flight promise and
      // notifies synchronously, so pending starts *with* the action instead of
      // after it. Only usable when the action resolves to this key's value.
      const lane = createLane();
      const action = deferred<string>();
      lane.set(KEY, "v1");

      const frames = newFrames();
      const app = await render(frames, () =>
        el(LaneProvider, { lane }, boundary("boot", [
          el(Reader, { id: "A", frames, flags: true, key: "A" }),
          el(Reader, { id: "B", frames, flags: true, key: "B" }),
        ])),
      );
      await settle(app);
      expect(text(app)).toBe("[A=v1:t0b0][B=v1:t0b0]");

      await act(async () => {
        lane.set(KEY, action.promise);
        await settlePromiseHandlers();
      });
      await settle(app);

      // Pending immediately, previous value still on screen.
      expect(text(app)).toBe("[A=v1:t1b0][B=v1:t1b0]");

      await act(async () => {
        action.resolve("v2");
        await settlePromiseHandlers();
      });
      await settle(app);
      expect(text(app)).toBe("[A=v2:t0b0][B=v2:t0b0]");
    });
  });
});

/* ------------------------------------------------------------------ *
 * Frame log
 * ------------------------------------------------------------------ */

type Frames = { container: HTMLElement | null; list: string[] };

function newFrames(): Frames {
  return { container: null, list: [] };
}

// Snapshots the committed DOM on every commit this component takes part in. All
// DOM mutations for a commit land before any layout effect runs, so whichever
// reader records first still sees the complete frame.
function useFrames(frames: Frames): void {
  React.useLayoutEffect(() => {
    const snapshot = frames.container?.textContent ?? "";

    if (frames.list[frames.list.length - 1] !== snapshot) {
      frames.list.push(snapshot);
    }
  });
}

// Frames in which two readers *of KEY* showed different values. Readers of other
// keys render with `~` instead of `=` so they stay out of this.
function tornFrames(frames: Frames): string[] {
  return frames.list.filter((frame) => {
    const values = new Set(
      [...frame.matchAll(/\[[A-Z]=([^:\]]+)/g)].map((match) => match[1]),
    );

    return values.size > 1;
  });
}

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

type Controls = {
  run?: (blocker: Promise<string>) => void;
  act?: (action: Promise<void>) => void;
};

const neverLoader: LaneLoader<string> = () => new Promise<string>(() => {});

function Reader({
  id,
  cacheKey = KEY,
  flags = false,
  foreign = false,
  frames,
  loader = neverLoader,
}: {
  id: string;
  cacheKey?: LaneKey;
  flags?: boolean;
  foreign?: boolean;
  frames: Frames;
  loader?: LaneLoader<string>;
}) {
  useFrames(frames);

  const result = useLane({ key: cacheKey, loader });
  const read = React.use(result.promise);
  const pending = flags
    ? `:t${result.isInvalidationPending ? 1 : 0}b${result.isBackgroundPending ? 1 : 0}`
    : "";

  return React.createElement(
    "span",
    null,
    `[${id}${foreign ? "~" : "="}${read.data}${pending}]`,
  );
}

// Invalidates KEY once, from a mount effect. Placed between two readers so it
// runs after the first has gone live and before the second has.
function Invalidate({ lane, background = false }: { lane: Lane; background?: boolean }) {
  React.useEffect(() => {
    lane.invalidate(KEY, background ? { background: true } : undefined);
  }, [lane, background]);

  return null;
}

// The same, from a mount *layout* effect. Placed after a mounting reader, it
// fires inside that reader's own commit — subscribed already, but only just.
function LayoutInvalidate({ lane }: { lane: Lane }) {
  React.useLayoutEffect(() => {
    lane.invalidate(KEY);
  }, [lane]);

  return null;
}

// Writes to the store from its own render body — a deterministic stand-in for an
// external event landing while React is yielded between two siblings of the same
// render pass.
function Interleave({ lane }: { lane: Lane }) {
  const done = React.useRef(false);

  if (!done.current) {
    done.current = true;
    lane.set(KEY, "v2");
  }

  return null;
}

type Mode =
  | "urgent-mount"
  | "urgent-switch"
  | "transition-mount"
  | "urgent-mount-unblocked";

// Writes KEY inside a transition that a second, still-loading key holds back,
// while a render-phase read of KEY happens at a different priority.
//
//   urgent-mount      a new reader of KEY mounts urgently  -> tears
//   urgent-switch     an existing reader switches onto KEY -> tears
//   transition-mount  the mount is inside the transition   -> safe
//
// `urgent-mount-unblocked` drops the blocker and makes KEY itself the pending
// one, which is the ordinary "invalidate -> refetch" shape -> also safe.
function MixedPriorityApp({
  lane,
  frames,
  ctl,
  mode,
}: {
  lane: Lane;
  frames: Frames;
  ctl: Controls;
  mode: Mode;
}) {
  const [showC, setShowC] = React.useState(false);
  const [dKey, setDKey] = React.useState<LaneKey>(OTHER);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    ctl.run = (blocker) => {
      const write = () => {
        lane.set(KEY, "v2");
        lane.set(BLOCKER, blocker); // pending: holds the transition back
      };

      if (mode === "urgent-mount-unblocked") {
        setShowC(true); // urgent, same as the torn case
        // ...but the only pending promise is KEY's own, so every reader —
        // including the urgent mount — waits on the same one.
        startTransition(() => {
          lane.set(KEY, blocker);
        });
        return;
      }

      if (mode === "transition-mount") {
        startTransition(() => {
          setShowC(true);
          write();
        });
        return;
      }

      // Urgent — jumps ahead of the transition scheduled right after it.
      if (mode === "urgent-switch") {
        setDKey(KEY);
      } else {
        setShowC(true);
      }

      startTransition(write);
    };
  });

  return el(LaneProvider, { lane }, [
    boundary(
      "boot",
      [
        el(Reader, { id: "A", frames, key: "A" }),
        el(Reader, { id: "B", frames, key: "B" }),
        el(Reader, { id: "X", cacheKey: BLOCKER, foreign: true, frames, key: "X" }),
      ],
      "main",
    ),
    boundary(
      "[D:loading]",
      [
        el(Reader, {
          id: "D",
          cacheKey: dKey,
          foreign: dKey !== KEY,
          frames,
          key: "D",
        }),
      ],
      "d",
    ),
    showC
      ? boundary("[C:loading]", [el(Reader, { id: "C", frames, key: "C" })], "c")
      : null,
  ]);
}

// `startTransition(async () => { await action; invalidate() })` — the shape that
// leaves readers with no pending signal until the action settles.
function ActionApp({
  lane,
  frames,
  ctl,
  loader,
  announce = false,
}: {
  lane: Lane;
  frames: Frames;
  ctl: Controls;
  loader: LaneLoader<string>;
  announce?: boolean;
}) {
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    ctl.act = (action) => {
      startTransition(async () => {
        if (announce) {
          // This component reads nothing, so it reaches the readers through the
          // scoped form rather than a bound one.
          lane.startInvalidationTransition(KEY);
        }

        await action;
        lane.invalidate(KEY);
      });
    };
  });

  return el(LaneProvider, { lane }, boundary("boot", [
    el(Reader, { id: "A", frames, flags: true, loader, key: "A" }),
    el(Reader, { id: "B", frames, flags: true, loader, key: "B" }),
  ]));
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

type App = { container: HTMLDivElement; root: Root };

// `children` is passed positionally, so it is stripped from the props the call
// site has to supply; the cast is confined to this one place.
function el<P extends object>(
  type: React.FunctionComponent<P>,
  props: Omit<P, "children"> & { key?: React.Key },
  children?: React.ReactNode,
): React.ReactElement {
  return React.createElement(type, props as P & React.Attributes, children);
}

function boundary(
  fallback: string,
  children: React.ReactNode[],
  key?: string,
): React.ReactElement {
  return React.createElement(React.Suspense, { fallback, key }, children);
}

async function render(
  frames: Frames,
  build: () => React.ReactElement,
): Promise<App> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);
  frames.container = container;

  await act(async () => {
    root.render(build());
    await settlePromiseHandlers();
  });

  return { container, root };
}

// Re-renders an existing root, for the tests that need a reader to mount into a
// commit some *other* reader is already subscribed in.
async function rerender(
  app: App,
  build: () => React.ReactElement,
): Promise<void> {
  await act(async () => {
    app.root.render(build());
    await settlePromiseHandlers();
  });
}

function unmount(app: App): void {
  const index = roots.indexOf(app.root);

  if (index >= 0) {
    roots.splice(index, 1);
  }

  act(() => {
    app.root.unmount();
  });
}

function text(app: App): string {
  return app.container.textContent ?? "";
}

// Drain React until the DOM stops changing, so assertions run on a quiet tree.
async function settle(app: App): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const previous = text(app);

    await act(async () => {
      await settlePromiseHandlers();
    });

    if (text(app) === previous) {
      return;
    }
  }
}
