// @vitest-environment jsdom

/**
 * The bound `invalidate` returned by `useLane` is awaitable: it returns the
 * next read's promise — the one every subscribed reader of the key adopts, by
 * the store's dedupe — with the read's usual contracts intact (stale-on-error
 * resolves, an `onlyIf` skip returns the current cached promise). The gated
 * form widens to `undefined`: no loader, no next read to return.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLane } from "../index";
import { readOrCreate, resetVitest } from "./test-utils";
import type {
  Lane,
  LaneGatedResult,
  LaneLoader,
  LaneResult,
} from "../types";

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

describe("awaitable invalidate", () => {
  it("resolves to the refetched read", async () => {
    const lane = createLane();
    let value = "one";
    const loader = vi.fn(async () => value);

    const { result, container } = await mount(lane, loader);

    expect(container.textContent).toBe("one");

    value = "two";
    let next: Awaited<ReturnType<typeof result.invalidate>>;
    await act(async () => {
      next = await result.invalidate();
    });

    expect(next!).toMatchObject({ data: "two" });
    expect(loader).toHaveBeenCalledTimes(2);
    // The reader converged onto the same settlement the caller awaited.
    expect(container.textContent).toBe("two");
  });

  it("returns the promise the readers adopt — not a second fetch", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const { result } = await mount(lane, loader);

    let returned: Promise<unknown> | undefined;
    await act(async () => {
      returned = result.invalidate();
      await returned;
    });

    // The store's dedupe is the guarantee: a read of the key while the re-read
    // is what the entry holds must be the very same promise.
    expect(returned).toBe(readOrCreate(lane, ["tasks"], loader));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("an `onlyIf` skip returns the current cached promise", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const { result } = await mount(lane, loader);

    let returned: Promise<unknown> | undefined;
    await act(async () => {
      // Fresh forever by default (`staleTime` Infinity), so `onlyIf: "stale"`
      // declines — awaiting still lands on the key's current value.
      returned = result.invalidate({ onlyIf: "stale" });
      await returned;
    });

    await expect(returned).resolves.toMatchObject({ data: "loaded" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("resolves stale-on-error instead of rejecting", async () => {
    const lane = createLane();
    const error = new Error("network");
    let fail = false;
    const loader = vi.fn(async () => {
      if (fail) {
        throw error;
      }

      return "loaded";
    });

    const { result, container } = await mount(lane, loader);
    const first = await (result as LaneResult<string>).promise;

    fail = true;
    let next: Awaited<ReturnType<typeof result.invalidate>>;
    await act(async () => {
      next = await result.invalidate();
    });

    // The awaited value is the read's, contracts included: old data, its old
    // revision, and the failure riding alongside — no try/catch at the caller.
    expect(next!).toEqual({
      data: "loaded",
      error: error,
      revision: first.revision,
    });
    expect(container.textContent).toBe("loaded");
  });

  it("returns undefined while the read is gated off", async () => {
    const lane = createLane();
    const loader = vi.fn(async () => "loaded");

    const { result } = await mount(lane, loader, { enabled: false });

    let returned: Promise<unknown> | undefined;
    act(() => {
      returned = (result as LaneGatedResult<string>).invalidate();
    });

    expect(returned).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });
});

let latestResult: LaneResult<string> | LaneGatedResult<string>;

function Probe({
  enabled,
  loader,
}: {
  enabled: boolean;
  loader: LaneLoader<string>;
}) {
  const result = useLane({
    key: ["tasks"],
    loader: enabled ? loader : undefined,
  });
  latestResult = result;

  const value = result.promise ? React.use(result.promise).data : "disabled";

  return React.createElement("div", null, value);
}

async function mount(
  lane: Lane,
  loader: LaneLoader<string>,
  { enabled = true }: { enabled?: boolean } = {},
): Promise<{
  container: HTMLDivElement;
  result: LaneResult<string> | LaneGatedResult<string>;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: "loading" },
          React.createElement(Probe, { enabled, loader }),
        ),
      }),
    );
  });

  return { container, result: latestResult };
}
