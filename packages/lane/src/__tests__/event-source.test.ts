// No `@vitest-environment` header: this runs in the default *node* environment,
// which is the point — it proves the event sources work with no DOM, and that
// `domEventSource` safely no-ops when `window` is absent (a headless run).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReactNativeEventSource,
  domEventSource,
  noopEventSource,
} from "../event-source";
import type { ReactNativeAppState, ReactNativeNetInfo } from "../event-source";
import { resetVitest } from "./test-utils";

afterEach(resetVitest);

function fakeAppState(initial: string) {
  let handler: ((state: string) => void) | undefined;
  const remove = vi.fn(() => {
    handler = undefined;
  });

  const AppState = {
    currentState: initial,
    addEventListener: (_type: "change", next: (state: string) => void) => {
      handler = next;
      return { remove };
    },
  } satisfies ReactNativeAppState;

  return { AppState, emit: (state: string) => handler?.(state), remove };
}

function fakeNetInfo() {
  let handler: ((state: { isConnected: boolean | null }) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    handler = undefined;
  });

  const netInfo = {
    addEventListener: (
      next: (state: { isConnected: boolean | null }) => void,
    ) => {
      handler = next;
      return unsubscribe;
    },
  } satisfies ReactNativeNetInfo;

  return {
    netInfo,
    emit: (isConnected: boolean | null) => handler?.({ isConnected }),
    unsubscribe,
  };
}

describe("domEventSource without a DOM", () => {
  it("no-ops when window is absent and never fires", () => {
    expect(typeof window).toBe("undefined");

    const onFocus = vi.fn();
    const onReconnect = vi.fn();

    const cleanup = domEventSource({ onFocus, onReconnect });

    expect(cleanup).toBeUndefined();
    expect(onFocus).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe("noopEventSource", () => {
  it("returns nothing and never fires", () => {
    const onFocus = vi.fn();
    const onReconnect = vi.fn();

    expect(noopEventSource({ onFocus, onReconnect })).toBeUndefined();
    expect(onFocus).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe("createReactNativeEventSource — focus via AppState", () => {
  it("fires onFocus only when returning to the foreground", () => {
    const app = fakeAppState("background");
    const onFocus = vi.fn();
    const onReconnect = vi.fn();

    createReactNativeEventSource({ AppState: app.AppState })({
      onFocus,
      onReconnect,
    });

    app.emit("active");
    expect(onFocus).toHaveBeenCalledTimes(1);

    // Staying active is not a new foreground.
    app.emit("active");
    expect(onFocus).toHaveBeenCalledTimes(1);

    // A transient inactive then active (iOS) counts once, on the return.
    app.emit("inactive");
    app.emit("active");
    expect(onFocus).toHaveBeenCalledTimes(2);

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("does not fire when created while already active", () => {
    const app = fakeAppState("active");
    const onFocus = vi.fn();

    createReactNativeEventSource({ AppState: app.AppState })({
      onFocus,
      onReconnect: vi.fn(),
    });

    // Seeded from currentState "active": a redundant active change is a no-op.
    app.emit("active");
    expect(onFocus).not.toHaveBeenCalled();

    app.emit("background");
    app.emit("active");
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("removes the AppState subscription on cleanup", () => {
    const app = fakeAppState("active");

    const cleanup = createReactNativeEventSource({ AppState: app.AppState })({
      onFocus: vi.fn(),
      onReconnect: vi.fn(),
    });

    cleanup?.();
    expect(app.remove).toHaveBeenCalledTimes(1);
  });
});

describe("createReactNativeEventSource — reconnect via NetInfo", () => {
  it("fires onReconnect only on a disconnected → connected edge", () => {
    const app = fakeAppState("active");
    const net = fakeNetInfo();
    const onReconnect = vi.fn();

    createReactNativeEventSource({ AppState: app.AppState, netInfo: net.netInfo })(
      { onFocus: vi.fn(), onReconnect },
    );

    // First observation seeds state; it is not a reconnect.
    net.emit(true);
    expect(onReconnect).not.toHaveBeenCalled();

    net.emit(false);
    net.emit(true);
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // Staying connected is not a new reconnect.
    net.emit(true);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes both AppState and NetInfo on cleanup", () => {
    const app = fakeAppState("active");
    const net = fakeNetInfo();

    const cleanup = createReactNativeEventSource({
      AppState: app.AppState,
      netInfo: net.netInfo,
    })({ onFocus: vi.fn(), onReconnect: vi.fn() });

    cleanup?.();
    expect(app.remove).toHaveBeenCalledTimes(1);
    expect(net.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("wires no reconnect when no NetInfo is supplied", () => {
    const app = fakeAppState("active");
    const onReconnect = vi.fn();

    const cleanup = createReactNativeEventSource({ AppState: app.AppState })({
      onFocus: vi.fn(),
      onReconnect,
    });

    // Nothing to emit reconnect through; cleanup still tears down AppState.
    cleanup?.();
    expect(onReconnect).not.toHaveBeenCalled();
    expect(app.remove).toHaveBeenCalledTimes(1);
  });
});
