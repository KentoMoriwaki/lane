// @vitest-environment jsdom
//
// What a Suspense boundary shows while a transition is in flight, and what that
// means for recovering from an Error Boundary.
//
// A transition protects content a boundary has *already revealed*. A boundary
// mounted by that same transition has revealed nothing, so it falls back like
// any first render — which is what makes error recovery work: the error
// fallback replaced the children, so resetting remounts the Suspense and the
// retry shows a skeleton instead of leaving the error on screen.

import * as React from "react";
import { act, use, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLane } from "../index";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

const roots: Root[] = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
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

function el<P extends object>(
  type: React.FunctionComponent<P> | React.ComponentClass<P>,
  props: Omit<P, "children"> & { key?: React.Key },
  children?: React.ReactNode,
): React.ReactElement {
  return React.createElement(type, props as P & React.Attributes, children);
}

function suspense(fallback: string, children: React.ReactNode): React.ReactElement {
  return React.createElement(React.Suspense, { fallback }, children);
}

/**
 * Pump until the rendered text stops changing, so an observation is never just
 * an under-flushed frame. Stricter than `tearing.test.ts`'s `settle` because
 * these cases start from a suspended mount, where the first flush changes
 * nothing yet: it takes consecutive stable rounds, and a task turn as well as
 * microtasks (React schedules its Suspense retry on a task).
 */
async function settle(container: HTMLElement): Promise<string> {
  let stable = 0;

  for (let i = 0; i < 40; i += 1) {
    const previous = container.textContent;

    await act(async () => {
      await settlePromiseHandlers();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    stable = container.textContent === previous ? stable + 1 : 0;
    if (stable >= 3 && i >= 4) break;
  }

  return container.textContent ?? "";
}

async function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // Awaited: a suspending initial render is not handled by a sync `act`.
  await act(async () => {
    root.render(element);
  });
  return container;
}

describe("what a transition holds", () => {
  it("falls back for a boundary mounted by the transition", async () => {
    const gate = deferred<string>();
    const Child = () => use(gate.promise);
    let reveal!: () => void;

    function App() {
      const [show, setShow] = useState(false);
      reveal = () => React.startTransition(() => setShow(true));

      return show ? suspense("SKELETON", el(Child, {})) : "IDLE";
    }

    const container = await mount(el(App, {}));
    expect(container.textContent).toBe("IDLE");

    await act(async () => {
      reveal();
    });

    // The boundary is new in this update, so it has revealed nothing for the
    // transition to protect.
    expect(await settle(container)).toBe("SKELETON");

    gate.resolve("DATA");
    expect(await settle(container)).toBe("DATA");
  });

  it("holds the revealed content of a boundary that already existed", async () => {
    // The counterpart, and the check that transitions are live in this harness:
    // without it, the fallback above could just be a transition that never took.
    const first = deferred<string>();
    const second = deferred<string>();
    first.resolve("V1");

    const Child = ({ gate }: { gate: Promise<string> }) => use(gate);
    let swap!: () => void;

    function App() {
      const [gate, setGate] = useState(first.promise);
      swap = () => React.startTransition(() => setGate(second.promise));

      return suspense("SKELETON", el(Child, { gate }));
    }

    const container = await mount(el(App, {}));
    expect(await settle(container)).toBe("V1");

    await act(async () => {
      swap();
    });

    expect(await settle(container)).toBe("V1");

    second.resolve("V2");
    expect(await settle(container)).toBe("V2");
  });

  it("falls back for the same reveal outside a transition", async () => {
    // The first case without the transition: same result, so the transition is
    // not what decides a newly mounted boundary's fallback.
    const gate = deferred<string>();
    const Child = () => use(gate.promise);
    let reveal!: () => void;

    function App() {
      const [show, setShow] = useState(false);
      reveal = () => setShow(true);

      return show ? suspense("SKELETON", el(Child, {})) : "IDLE";
    }

    const container = await mount(el(App, {}));

    await act(async () => {
      reveal();
    });

    expect(await settle(container)).toBe("SKELETON");

    gate.resolve("DATA");
    expect(await settle(container)).toBe("DATA");
  });
});

type BoundaryProps = {
  children: React.ReactNode;
  resetKey: unknown;
  onReset: () => void;
};

type BoundaryState = { error: unknown; resetKey: unknown };

/**
 * The minimum that recovers: catch, and clear the caught error when the promise
 * identity changes. Clearing it on the click instead would re-render the
 * children against the promise the reader still holds — the rejected one — and
 * error again before the retry's promise has replaced it.
 *
 * The clear happens in render (`getDerivedStateFromProps`) rather than after
 * commit, so it lands inside the same transition that delivered the new
 * promise. That is the stricter case for the assertion below: even with nothing
 * urgent involved, the remounted boundary still falls back.
 */
class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (props.resetKey === state.resetKey) {
      return null;
    }

    return { error: null, resetKey: props.resetKey };
  }

  render() {
    return this.state.error !== null
      ? React.createElement("button", { onClick: this.props.onReset }, "ERROR")
      : this.props.children;
  }
}

describe("recovering from a first-load failure", () => {
  it("shows the skeleton, not the error, while the retry is in flight", async () => {
    const lane = createLane();
    const second = deferred<string>();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => second.promise);

    const Inner = ({ promise }: { promise: Promise<{ data: string }> }) =>
      use(promise).data;

    function Outer() {
      // `useLane` sits *above* the boundary: the subscription and `invalidate`
      // survive the error, which is what lets the fallback drive the retry.
      const { promise, invalidate } = useLane<string>({
        key: ["tasks"],
        loader,
      });

      return el(
        Boundary,
        { resetKey: promise, onReset: () => void invalidate() },
        suspense("SKELETON", el(Inner, { promise })),
      );
    }

    const container = await mount(
      el(LaneProvider, { lane }, el(Outer, {})),
    );

    expect(await settle(container)).toBe("ERROR");

    await act(async () => {
      container.querySelector("button")!.click();
    });

    // `invalidate` converges through the hook's explicit transition, but the
    // reset remounts the Suspense, so the retry is a fresh boundary.
    expect(await settle(container)).toBe("SKELETON");

    second.resolve("DATA");
    expect(await settle(container)).toBe("DATA");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
