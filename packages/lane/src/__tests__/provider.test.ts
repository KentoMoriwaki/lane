// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LaneEventSource, LaneRevalidateHandlers } from "../event-source";
import { LaneProvider, useLaneRevalidation } from "../provider";
import type { Revalidator } from "../provider";
import { resetVitest, settlePromiseHandlers } from "./test-utils";

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

// Registers a revalidator with the surrounding provider for its lifetime — the
// same wiring `useLane` / `useLanesAll` use, reduced to its essence.
function Probe({ revalidator }: { revalidator: Revalidator }) {
  const revalidation = useLaneRevalidation();

  React.useEffect(
    () => revalidation.subscribe(revalidator),
    [revalidation, revalidator],
  );

  return null;
}

// A source whose focus / reconnect signals the test drives by hand — no DOM
// events involved, so it doubles as proof the provider fans out from an injected
// source, not from `window` / `document`.
function controllableSource() {
  let captured: LaneRevalidateHandlers | undefined;
  const cleanup = vi.fn();
  const source: LaneEventSource = (handlers) => {
    captured = handlers;
    return cleanup;
  };

  return {
    source,
    cleanup,
    fireFocus: () => captured?.onFocus(),
    fireReconnect: () => captured?.onReconnect(),
  };
}

async function renderProvider(
  children: React.ReactNode,
  props: { focusThrottleInterval?: number; eventSource?: LaneEventSource } = {},
): Promise<Root> {
  const container = document.createElement("div");
  const root = createRoot(container);

  document.body.append(container);
  roots.push(root);

  await act(async () => {
    root.render(React.createElement(LaneProvider, { ...props, children }));
    await settlePromiseHandlers();
  });

  return root;
}

async function fire(type: string, target: EventTarget = window): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new Event(type));
    await settlePromiseHandlers();
  });
}

describe("LaneProvider revalidation", () => {
  it("fans window focus out to the registered focus handlers", async () => {
    const onFocus = vi.fn();
    const onReconnect = vi.fn();
    await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus, onReconnect } }),
    );

    await fire("focus");

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("fans the online event out to the reconnect handlers only", async () => {
    const onFocus = vi.fn();
    const onReconnect = vi.fn();
    await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus, onReconnect } }),
    );

    await fire("online");

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("treats a document becoming visible as a focus", async () => {
    const onFocus = vi.fn();
    await renderProvider(React.createElement(Probe, { revalidator: { onFocus } }));

    // jsdom reports visibilityState "visible" by default.
    await fire("visibilitychange", document);

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("fans out to every registered revalidator", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await renderProvider(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Probe, { revalidator: { onFocus: first } }),
        React.createElement(Probe, { revalidator: { onFocus: second } }),
      ),
    );

    await fire("focus");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("throttles focus within the window and allows it again after it passes", async () => {
    vi.useFakeTimers();

    const onFocus = vi.fn();
    await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus } }),
      { focusThrottleInterval: 5_000 },
    );

    await fire("focus");
    expect(onFocus).toHaveBeenCalledTimes(1);

    // Within the window, focus and visibilitychange coalesce into nothing.
    await fire("focus");
    await fire("visibilitychange", document);
    expect(onFocus).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    await fire("focus");
    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it("stops firing a revalidator once its reader unmounts", async () => {
    const onFocus = vi.fn();
    const root = await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus } }),
    );

    await fire("focus");
    expect(onFocus).toHaveBeenCalledTimes(1);

    // Re-render without the probe: its subscription is torn down.
    await act(async () => {
      root.render(React.createElement(LaneProvider, { children: null }));
      await settlePromiseHandlers();
    });

    await fire("focus");
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe("LaneProvider with a custom event source", () => {
  it("fans an injected source's focus and reconnect out to revalidators", async () => {
    const source = controllableSource();
    const onFocus = vi.fn();
    const onReconnect = vi.fn();
    await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus, onReconnect } }),
      { eventSource: source.source },
    );

    await act(async () => {
      source.fireFocus();
      await settlePromiseHandlers();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();

    await act(async () => {
      source.fireReconnect();
      await settlePromiseHandlers();
    });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("applies the focus throttle to an injected source", async () => {
    vi.useFakeTimers();

    const source = controllableSource();
    const onFocus = vi.fn();
    await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus } }),
      { eventSource: source.source, focusThrottleInterval: 5_000 },
    );

    await act(async () => {
      source.fireFocus();
      await settlePromiseHandlers();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);

    await act(async () => {
      source.fireFocus();
      await settlePromiseHandlers();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    await act(async () => {
      source.fireFocus();
      await settlePromiseHandlers();
    });
    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it("runs the source's cleanup when the provider unmounts", async () => {
    const source = controllableSource();
    const root = await renderProvider(
      React.createElement(Probe, { revalidator: { onFocus: vi.fn() } }),
      { eventSource: source.source },
    );

    expect(source.cleanup).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });

    expect(source.cleanup).toHaveBeenCalledTimes(1);
  });
});
