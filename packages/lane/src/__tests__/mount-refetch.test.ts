// @vitest-environment jsdom
import { Activity, StrictMode, Suspense, act, createElement as h, use } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLane } from "../index";
import type { Lane, LaneUseOptions } from "../types";

let root: Root;
let container: HTMLDivElement;
let lane: Lane;
let loader: ReturnType<typeof vi.fn<() => Promise<string>>>;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  lane = createLane({ gcTime: Infinity });
  lane.set(["a"], "cached-a");
  lane.set(["b"], "cached-b");
  loader = vi.fn(async () => "fresh");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Reader({ id, enabled, options }: {
  id: string; enabled: boolean; options: LaneUseOptions;
}) {
  const { promise } = useLane({ key: [id], loader: enabled ? loader : undefined, ...options });
  return h("p", null, promise ? use(promise).data : "disabled");
}

async function render({ id = "a", enabled = true, hidden = false, count = 1,
  options = { refetchOnMount: true, staleTime: 0 }, target = lane }:
  { id?: string; enabled?: boolean; hidden?: boolean; count?: number;
    options?: LaneUseOptions; target?: Lane } = {}) {
  await act(async () => root.render(h(StrictMode, null,
    h(LaneProvider, { lane: target, children:
      h(Activity, { mode: hidden ? "hidden" : "visible", children:
        h(Suspense, { fallback: "loading" },
          Array.from({ length: count }, (_, key) => h(Reader, { key, id, enabled, options }))) }) }))));
}

async function runMountTasks() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe("deferred mount revalidation", () => {
  it("preserves the warm promise until the next task, dedupes fast sibling reads and StrictMode replay", async () => {
    await render({ count: 2 });
    expect(container.textContent).toBe("cached-acached-a");
    expect(loader).not.toHaveBeenCalled();
    await runMountTasks();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("freshfresh");
  });

  for (const change of ["unmount", "disable", "hide", "key", "lane"] as const) {
    it(`cancels obsolete work on ${change}`, async () => {
      await render();
      if (change === "unmount") await act(async () => root.render(null));
      if (change === "disable") await render({ enabled: false });
      if (change === "hide") await render({ hidden: true });
      if (change === "key") await render({ id: "b", options: { refetchOnMount: false } });
      if (change === "lane") {
        const next = createLane({ gcTime: Infinity });
        next.set(["a"], "other-lane");
        await render({ target: next, options: { refetchOnMount: false } });
      }
      await runMountTasks();
      expect(loader).not.toHaveBeenCalled();
      if (change === "hide") {
        await render();
        await runMountTasks();
        expect(loader).toHaveBeenCalledTimes(1);
        expect(container.textContent).toBe("fresh");
      }
    });
  }

  for (const options of [
    { refetchOnMount: false, staleTime: 0 },
    { refetchOnMount: true, staleTime: Infinity },
  ]) {
    it(`uses current options at execution: ${JSON.stringify(options)}`, async () => {
      await render();
      await render({ options });
      await runMountTasks();
      expect(loader).not.toHaveBeenCalled();
      expect(container.textContent).toBe("cached-a");
    });
  }

  for (const update of ["set", "update", "invalidate", "focus"] as const) {
    it(`does not replace intervening ${update}, even after it settles with staleTime 0`, async () => {
      await render({ options: { refetchOnMount: true, refetchOnFocus: true, staleTime: 0 } });
      await act(async () => {
        if (update === "set") lane.set(["a"], "published");
        if (update === "update") await lane.update(["a"], () => "published");
        if (update === "invalidate") lane.invalidate(["a"]);
        if (update === "focus") window.dispatchEvent(new Event("focus"));
      });
      const loads = update === "invalidate" || update === "focus" ? 1 : 0;
      expect(loader).toHaveBeenCalledTimes(loads);
      await runMountTasks();
      expect(loader).toHaveBeenCalledTimes(loads);
      expect(container.textContent).toBe(loads ? "fresh" : "published");
    });
  }
});
