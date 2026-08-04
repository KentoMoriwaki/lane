// @vitest-environment jsdom
//
// What a caller's transition covers once Lane's notification is inside it.
//
// `docs/consistency.md` states that subscribed readers of one key converge in a
// single commit because the notification fans out synchronously and "their
// transitions share React's per-event transition lane". These two tests pin the
// part of that claim that reaches *outside* Lane: the entanglement holds across
// an `await`, so a reader's convergence joins the transition the caller started
// rather than opening one of its own.
//
// The distinction decides whether Lane needs machinery to keep readers pending
// across a mutation, or whether React's own entanglement already does it.

import * as React from "react";
import { act, use, useTransition } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLane, LaneProvider, useLane, useLaneInstance } from "../index";
import type { LaneLoader } from "../types";
import { deferred, resetVitest, settlePromiseHandlers } from "./test-utils";

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

async function mount(element: React.ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  // Awaited: the Lane tree suspends on its first read, so a synchronous `act`
  // would return with the fallback still mounted and nothing to click.
  await act(async () => {
    root.render(element);
    await settlePromiseHandlers();
  });

  return container;
}

async function click(container: HTMLElement): Promise<void> {
  const target = container.querySelector('[data-testid="save"]');

  if (!(target instanceof HTMLElement)) {
    throw new Error("Missing save button");
  }

  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settlePromiseHandlers();
  });
}

function Reader({ loader }: { loader: LaneLoader<string> }) {
  const { isInvalidationPending, promise } = useLane({
    key: ["tasks"],
    loader,
  });
  const { data } = use(promise);

  return React.createElement(
    "span",
    null,
    `${data}|reader:${isInvalidationPending ? 1 : 0}`,
  );
}

/**
 * The mutating component, in a subtree of its own: it reads nothing, so the only
 * thing that can reach the reader is Lane's notification.
 */
function Mutator({ action }: { action: () => Promise<void> }) {
  const lane = useLaneInstance();
  const [isPending, startTransition] = useTransition();

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("button", {
      "data-testid": "save",
      onClick: () => {
        startTransition(async () => {
          await action();
          lane.invalidate(["tasks"]);
        });
      },
    }),
    React.createElement("span", null, `|caller:${isPending ? 1 : 0}`),
  );
}

describe("transition entanglement", () => {
  it("keeps the caller pending until the reader it invalidated converges", async () => {
    const lane = createLane();
    const mutation = deferred<void>();
    const reload = deferred<string>();
    const loader = vi.fn<LaneLoader<string>>(() => reload.promise);

    lane.set(["tasks"], "cached");

    const container = await mount(
      React.createElement(LaneProvider, {
        lane,
        children: React.createElement(
          React.Suspense,
          { fallback: "loading" },
          React.createElement(Reader, { loader }),
          React.createElement(Mutator, { action: () => mutation.promise }),
        ),
      }),
    );

    const timeline: string[] = [];
    const snap = () => timeline.push(container.textContent ?? "");

    snap();
    await click(container);
    snap();

    // The action lands, so `lane.invalidate` runs after the `await` — inside
    // the async transition scope the click opened.
    await act(async () => {
      mutation.resolve();
      await mutation.promise;
      await settlePromiseHandlers();
    });

    snap();

    await act(async () => {
      reload.resolve("reloaded");
      await reload.promise;
      await settlePromiseHandlers();
    });

    snap();

    expect(timeline).toEqual([
      "cached|reader:0|caller:0",
      // The reader knows nothing yet: notification is Lane's only channel and
      // the action has not landed, so it is not pending while the caller is.
      "cached|reader:0|caller:1",
      // Invalidated. The caller is *still* pending even though its action has
      // settled — the reader's re-read joined the caller's transition instead
      // of starting its own, so the scope cannot commit until the read does.
      "cached|reader:1|caller:1",
      "reloaded|reader:0|caller:0",
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("holds a bare startTransition open for the caller's whole scope", async () => {
    const mutation = deferred<void>();
    const listeners = new Set<(fn: () => void) => void>();

    // Stands in for a reader that is told to open its transition without being
    // given anything to re-read: no state update, no cache change.
    function Watcher({ label }: { label: string }) {
      const [isPending, startTransition] = useTransition();

      React.useEffect(() => {
        listeners.add(startTransition);
        return () => {
          listeners.delete(startTransition);
        };
      }, [startTransition]);

      return React.createElement("span", null, `|${label}:${isPending ? 1 : 0}`);
    }

    function Caller() {
      const [isPending, startTransition] = useTransition();

      return React.createElement(
        React.Fragment,
        null,
        React.createElement("button", {
          "data-testid": "save",
          onClick: () => {
            startTransition(async () => {
              for (const open of listeners) {
                open(() => {});
              }

              await mutation.promise;
            });
          },
        }),
        React.createElement("span", null, `caller:${isPending ? 1 : 0}`),
      );
    }

    const container = await mount(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Caller, null),
        React.createElement(Watcher, { label: "a" }),
        React.createElement(Watcher, { label: "b" }),
      ),
    );

    const timeline: string[] = [];
    const snap = () => timeline.push(container.textContent ?? "");

    snap();
    await click(container);
    snap();

    await act(async () => {
      mutation.resolve();
      await mutation.promise;
      await settlePromiseHandlers();
    });

    snap();

    expect(timeline).toEqual([
      "caller:0|a:0|b:0",
      // An empty `startTransition` has nothing to schedule, yet both watchers
      // report pending for as long as the caller's scope runs: `isPending` is
      // itself transition-lane state, so its reset is entangled and cannot
      // commit before the scope does.
      "caller:1|a:1|b:1",
      "caller:0|a:0|b:0",
    ]);
  });
});
