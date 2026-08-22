// @vitest-environment jsdom

/**
 * An external read is an ordinary read whose loader the owner holds: the value
 * arrives by publication (an RSC payload through `<LaneHydration>`, a router's
 * loader data), and a re-read asks the owner to publish again.
 *
 * `external` is a real loader, so nothing in the read paths branches on it. What
 * it does when it runs is wait: the promise is settled by being replaced, or it
 * rejects on the timeout — and the ask that makes a publication come is the
 * lane's `refresh`, fired by the *read* rather than from inside the loader. The
 * client mutation surface is open on such an entry like on any other; what stays
 * different is retention (reachability — a `WeakRef` tethered by the publication
 * and by every committed reader — instead of `gcTime`), the shell that outlives
 * its value carrying the fact that an owner fills this key, and `prefetch`,
 * which has no loader to run.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import { setExternalRefFactory } from "../core";
import { readOrCreate } from "./test-utils";
import {
  createLane,
  external,
  laneRead,
  LaneExternalTimeoutError,
  LaneHydration,
  LaneOwnershipError,
  LaneProvider,
  useLane,
  useLanePromise,
} from "../index";
import { EXTERNAL_TIMEOUT } from "../external";
import { hydrateMany, publishedBy } from "../hydrate";
import type {
  Lane,
  LaneExternalReadSpec,
  LaneGatedResult,
  LaneHydrationSnapshots,
  LaneKeyOf,
  LaneRead,
  LaneReadSpec,
  LaneResult,
} from "../types";
import {
  deferred,
  resetVitest,
  settlePromiseHandlers,
  subscribe,
  subscribeLane,
} from "./test-utils";

type Mode = "hidden" | "visible";

const roots: Root[] = [];

let fallbackRenders = 0;

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
  fallbackRenders = 0;
  setExternalRefFactory(undefined);
  resetVitest();
});

describe("the external wait", () => {
  it("waits instead of loading, and resolves with the publication", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    await flushMicrotasks();

    // The wait *was* the next publication of this key, so it settles with it
    // rather than being abandoned — the only thing a reader suspended on it can
    // be told, since it has no subscription to notify.
    expect(waiting.status).toBe("fulfilled");
    expect(waiting.value).toEqual({ revision: expect.any(Number), data: "published" });

    // And the store's own promise holds the same publication, so a reader that
    // retried and one that kept the old promise agree.
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });

    // The timeout that would have fired is gone with the wait it belonged to.
    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT * 2);
    await flushMicrotasks();

    expect(waiting.status).toBe("fulfilled");
  });

  it("leaves a client-owned read's abort exactly as it was", async () => {
    const lane = createLane();
    let signal: AbortSignal | undefined;
    const loader = vi.fn((context: { signal: AbortSignal }) => {
      signal = context.signal;
      return new Promise<string>(() => {});
    });

    void readOrCreate<string>(lane, ["task", "t1"], loader);
    await flushMicrotasks();

    // The publication channel rides the abort reason, and only an external
    // entry's abort carries one: a client loader still sees the plain
    // `AbortError` it has always seen when its read is superseded.
    lane.set(["task", "t1"], "published");

    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as Error | undefined)?.name).toBe("AbortError");
  });

  it("leaves a wait unsettled when it is stopped without a publication", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await flushMicrotasks();

    // An abort that carries no value has nothing to resolve with, so the wait is
    // dropped rather than settled — rejecting it would be an unhandled rejection
    // for a read the caller itself stopped. Its timer goes with it.
    lane.cancel(["task", "t1"]);
    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT * 2);
    await flushMicrotasks();

    expect(waiting.status).toBe("pending");
  });

  it("rejects with a timeout naming the key when nothing publishes it", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT - 1);
    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    expect(waiting.status).toBe("rejected");
    expect(waiting.error).toBeInstanceOf(LaneExternalTimeoutError);
    expect((waiting.error as LaneExternalTimeoutError).keyId).toBe(
      '["task","t1"]',
    );
    expect((waiting.error as Error).message).toContain('["task","t1"]');
  });

  it("names `refresh` in the timeout, since that is what would have asked", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT);
    await flushMicrotasks();

    const message = (waiting.error as Error).message;

    expect(message).toContain("invalidated or collected");
    expect(message).toContain("refresh");
  });

  it("keeps no rejection: the next read is a fresh wait", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT);
    await flushMicrotasks();
    expect(waiting.status).toBe("rejected");

    // A rejection an external key kept would be sticky in the one place it must
    // not be: an error boundary's retry, and a reveal, are both re-reads, and
    // both need to end in a new ask rather than in the failure already reported.
    const retried = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();
    expect(retried.status).toBe("pending");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "late" }],
    });
    await flushMicrotasks();

    expect(retried.status).toBe("fulfilled");
    expect(retried.value).toEqual({ revision: expect.any(Number), data: "late" });
  });
});

describe("the client mutation surface on an external entry", () => {
  it("writes a value the client has, in place", async () => {
    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    const written = lane.set(["task", "t1"], "client");

    // A `set` on a published key is an ordinary write: the client had the value
    // (a mutation's own response), so the promise is fulfilled with no
    // microtask in between and every reader converges without a fallback.
    expect(stamps(written).status).toBe("fulfilled");
    await expect(written).resolves.toEqual({
      revision: expect.any(Number),
      data: "client",
    });
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "client" });
  });

  it("notifies readers of a client write through the transition channel", () => {
    const lane = createLane();
    const notified = vi.fn();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    subscribeLane(lane, ["task", "t1"], { onInvalidate: notified });

    lane.set(["task", "t1"], "client");

    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified.mock.calls[0]?.[1]).toBe("transition");
  });

  it("keeps a written entry external, so retention stays the owner's", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.set(["task", "t1"], "client");

    // The write sits in the publication's bucket, so the payload's collection
    // takes both — one rule for the value and for what overwrote it. The
    // recovery is the collected publication's: the next read waits and asks.
    refs.collect();

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();

    expect(waiting.status).toBe("pending");
  });

  it("updates a published value from what it holds", async () => {
    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    await expect(
      lane.update<string>(["task", "t1"], (task) => `${task}+edited`),
    ).resolves.toEqual({
      revision: expect.any(Number),
      data: "published+edited",
    });
  });

  it("invalidates a published key: the value goes, the shell does not", async () => {
    vi.useFakeTimers();

    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    lane.invalidate(["task", "t1"]);

    // Marking it stale discards the value and asks nothing of the client: the
    // next read is a wait for the owner's answer.
    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "republished" }],
    });
    await flushMicrotasks();

    expect(waiting.value).toEqual({
      revision: expect.any(Number),
      data: "republished",
    });
  });

  it("removes a published key", async () => {
    vi.useFakeTimers();

    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.remove(["task", "t1"]);

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();

    expect(waiting.status).toBe("pending");
  });

  it("applies the scoped variants across published and client-owned alike", async () => {
    vi.useFakeTimers();

    const lane = createLane();

    lane.set(["task", "t1"], "client");
    hydrateMany(lane, {
      entries: [{ key: ["task", "t2"], data: "published" }],
    });

    const updated = lane.updateAll<string>(["task"], () => "edited");

    expect(updated).toHaveLength(2);
    await expect(Promise.all(updated)).resolves.toEqual([
      { revision: expect.any(Number), data: "edited" },
      { revision: expect.any(Number), data: "edited" },
    ]);

    expect(() => lane.invalidateAll(["task"])).not.toThrow();
    expect(() => lane.removeAll(["task"])).not.toThrow();
    expect(() => lane.startInvalidationTransition(["task"])).not.toThrow();
  });

  it("refuses to prefetch an external read, and says why", () => {
    const lane = createLane();
    // Rejected by `prefetch`'s parameter type as well (see the type
    // expectations below); this is the cast that gets past it.
    const spec = laneRead<string>({ key: ["task", "t1"], loader: external });

    expect(() =>
      lane.prefetch(spec as unknown as LaneReadSpec<string>),
    ).toThrow(LaneOwnershipError);
    // The one refusal left, and it is about running a loader — not about who
    // may write.
    expect(() =>
      lane.prefetch(spec as unknown as LaneReadSpec<string>),
    ).toThrow(/\["task","t1"\][\s\S]*`prefetch`[\s\S]*no loader to run/);
  });

  // Seeding is a claim of ownership, so a key that is seeded and *also* read
  // with a client loader has two owners. The store settles that in the
  // publisher's favour and says nothing: the read runs, and what it produces is
  // held weakly with no `lastFulfilled` behind it, so the mistake surfaces
  // later — at a write that throws, or a value that quietly went missing. The
  // read is where both halves are visible, so the read is where it is reported.
  describe("a client loader on a published key", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("warns in development, naming the key", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lane = createLane();

      hydrateMany(lane, {
        entries: [{ key: ["seeded", "warns"], data: "published" }],
      });
      await readOrCreate(lane, ["seeded", "warns"], async () => "client");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('["seeded","warns"]');
      expect(warn.mock.calls[0]?.[0]).toContain("loader: external");
    });

    it("warns once for a key, not on every read of it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lane = createLane();
      const loader = async () => "client";

      hydrateMany(lane, {
        entries: [{ key: ["seeded", "once"], data: "published" }],
      });
      // A reader re-reads on every notification and every reveal; one warning
      // per read would bury the console it is trying to reach.
      await readOrCreate(lane, ["seeded", "once"], loader);
      await readOrCreate(lane, ["seeded", "once"], loader);
      await readOrCreate(lane, ["seeded", "once"], loader);

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays quiet for the combinations that are not a mistake", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lane = createLane();

      hydrateMany(lane, {
        entries: [{ key: ["seeded", "quiet"], data: "published" }],
      });

      // Reading a seeded key the declared way, and reading an *unseeded* key
      // with a client loader. Neither is two owners.
      await readOrCreate(lane, ["seeded", "quiet"], external);
      await readOrCreate(lane, ["client", "quiet"], async () => "client");

      expect(warn).not.toHaveBeenCalled();
    });
  });
});

/**
 * The ask. An external read has no loader of its own to re-run, so what it does
 * about a value it has not got is ask the owner to render again — `refresh`,
 * which the app supplies (`() => router.refresh()`,
 * `() => revalidator.revalidate()`) and Lane calls out of render.
 */
describe("the owner-ask", () => {
  it("asks when a reader needs a value the owner has not supplied", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.invalidate(["task", "t1"]);

    void readOrCreate<string>(lane, ["task", "t1"], external);

    // Not from the read itself: reads run during render, and `router.refresh()`
    // dispatches a React update.
    expect(refresh).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("takes the ask from the provider that holds the lane", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane();
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(
        hydratedExternalApp(lane, snapshots, "visible", refresh),
      );
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      lane.invalidate(["task", "t1"]);
      await settlePromiseHandlers();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stays silent before anything has published the key", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    // A first mount: streaming SSR, or a reader outside every hydration
    // boundary. The payload is already on its way, so there is nothing to ask
    // for — this read waits in silence, exactly as it did before `refresh`.
    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks again when a reader re-reads a wait nobody has filled", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.invalidate(["task", "t1"]);

    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Why the ask hangs off the read and not off the wait: a navigation
    // discards a pending `router.refresh()` ("Navigations take priority over
    // any pending actions"), so the wait made before it would never be filled.
    // The reveal's re-read finds the same unsettled wait and asks again.
    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("never asks for a value that is already there", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    void readOrCreate<string>(lane, ["task", "t1"], external);
    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("never asks while a write of the client's own is in flight", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });
    const arriving = deferred<string>();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    // An unsettled entry is not by itself a reason to ask: this one is a client
    // write waiting on its own promise, and it will answer for itself.
    const written = lane.set(["task", "t1"], arriving.promise);

    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();
    expect(refresh).not.toHaveBeenCalled();

    arriving.resolve("client");
    await expect(written).resolves.toEqual({
      revision: expect.any(Number),
      data: "client",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks once for everything one run invalidated", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [
        { key: ["task", "t1"], data: "one" },
        { key: ["task", "t2"], data: "two" },
        { key: ["task", "t3"], data: "three" },
      ],
    });
    lane.invalidateAll(["task"]);

    for (const id of ["t1", "t2", "t3"]) {
      void readOrCreate<string>(lane, ["task", id], external);
    }

    await flushMicrotasks();

    // One `router.refresh()` re-renders the route that owns all three, so N
    // keys and N readers in one run are one thing to ask for.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("asks once per tick, not once per lifetime", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.invalidate(["task", "t1"]);

    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    // Nothing is tracked across ticks: `refresh` returns `void`, so there is no
    // completion to observe, and guessing one from the next publication is
    // wrong — a navigation's payload need not carry this key at all.
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits out the timeout when the lane has no ask", async () => {
    vi.useFakeTimers();

    const lane = createLane();

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.invalidate(["task", "t1"]);

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));

    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT);
    await flushMicrotasks();

    expect(waiting.status).toBe("rejected");
    expect(waiting.error).toBeInstanceOf(LaneExternalTimeoutError);
  });

  it("asks again after a timeout, on the read that follows it", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.invalidate(["task", "t1"]);

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await vi.advanceTimersByTimeAsync(EXTERNAL_TIMEOUT);
    await flushMicrotasks();
    expect(waiting.status).toBe("rejected");
    expect(refresh).toHaveBeenCalledTimes(1);

    // The rejection was reported and dropped, so the retry (an error boundary's,
    // a reveal's) is a fresh wait with a fresh ask rather than the same failure
    // handed back.
    const retried = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();

    expect(retried.status).toBe("pending");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("asks after an invalidation nobody was subscribed for", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    // No reader, so nothing is notified and nothing re-reads — the shell has to
    // survive on its own and keep the fact that an owner fills this key, or the
    // read at the next reveal would look like a first mount and wait in silence.
    lane.invalidate(["task", "t1"]);
    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("asks after a remove, which drops the value and not the fact", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    lane.remove(["task", "t1"]);

    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("asks when the value was collected rather than discarded", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    refs.collect();

    void readOrCreate<string>(lane, ["task", "t1"], external);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("converging on the answer", () => {
  it("keeps a visible reader on the old value until the publication lands", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      lane.invalidate(["task", "t1"]);
      await settlePromiseHandlers();
    });

    // The reader re-read in its own transition, so the committed frame is still
    // what it had — the boundary never falls back — while the ask goes out.
    // (React does *render* the fallback in a transition it will not commit, so
    // the committed DOM, not the render counter, is what says this.)
    expect(container.element.textContent).toBe("server-1");
    expect(valueElement(container.element).style.display).toBe("");
    expect(refresh).toHaveBeenCalledTimes(1);

    // What `refresh` gets the owner to do, done by hand.
    await act(async () => {
      hydrateMany(lane, {
        entries: [{ key: ["task", "t1"], data: "server-2" }],
      });
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
    // The publication resolved the wait itself, through the abort channel —
    // no reader was made to `setState` out of a suspended read.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leaves a hidden reader alone until the reveal asks for it", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "hidden"));
      await settlePromiseHandlers();
    });

    const fallbacksBeforeHidden = fallbackRenders;

    await act(async () => {
      lane.invalidate(["task", "t1"]);
      await settlePromiseHandlers();
    });

    // A hidden reader is unsubscribed and does not render, so marking its key
    // stale does nothing at all — no re-read, no ask, no route re-render for a
    // screen nobody is looking at.
    expect(refresh).not.toHaveBeenCalled();
    expect(fallbackRenders).toBe(fallbacksBeforeHidden);

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });

    // The reveal is a new appearance with nothing to show, so it suspends —
    // and that read is what asks.
    expect(container.element.textContent).toContain("loading");
    expect(fallbackRenders).toBeGreaterThan(fallbacksBeforeHidden);
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      hydrateMany(lane, {
        entries: [{ key: ["task", "t1"], data: "server-2" }],
      });
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
  });
});

describe("retention of an external entry", () => {
  it("is exempt from the lane's own collection", async () => {
    vi.useFakeTimers();

    const lane = createLane({ gcTime: 1_000 });

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    // A client-owned key losing its last subscriber is what arms the lane-wide
    // sweep; the external entry is idle throughout and must survive it.
    subscribe(lane, ["__churn__"])();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });
  });

  it("serves a value that is still reachable", async () => {
    const lane = createLane();
    setExternalRefFactory(controllableRefs().factory);

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });
  });

  it("reads a collected value as an absent one and waits again", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });

    // What a collection leaves behind: the shell, pointing at nothing. Both
    // states are correct by design, so a reader has to handle this one as
    // "not here" rather than as an error.
    refs.collect();

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();
    expect(waiting.status).toBe("pending");

    // And the key is filled by the same thing that filled it the first time.
    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "republished" }],
    });

    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "republished" });
  });

  it("holds a client-owned entry strongly, whatever external entries do", async () => {
    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);
    const loader = vi.fn(async () => "loaded");

    await readOrCreate(lane, ["task", "t1"], loader);
    refs.collect();

    await expect(readOrCreate(lane, ["task", "t1"], loader)).resolves.toEqual({ revision: expect.any(Number),
      data: "loaded",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("tethers what it published to the payload it came from", async () => {
    const lane = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [
        { key: ["task", "t1"], data: "one" },
        { key: ["task", "t2"], data: "two" },
      ],
    };

    hydrateMany(lane, snapshots);

    // The strong reference that keeps a published value alive for as long as
    // the framework holds the payload — the reason an external entry can afford
    // to hold it weakly.
    const tethered = publishedBy(snapshots);

    expect(tethered).toHaveLength(2);
    await expect(Promise.all(tethered ?? [])).resolves.toEqual([
      { revision: expect.any(Number), data: "one" },
      { revision: expect.any(Number), data: "two" },
    ]);
    expect(tethered?.[0]).toBe(
      readOrCreate<string>(lane, ["task", "t1"], external),
    );
  });

  it("hangs a second lane's copies off the same payload", async () => {
    const lane = createLane();
    const other = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "published" }],
    };

    hydrateMany(lane, snapshots);
    hydrateMany(other, snapshots);

    // One payload, two stores: each lane's copy has its own seat in the one
    // bucket, and a write to one lane's key leaves the other's alone.
    const tethered = publishedBy(snapshots);

    expect(tethered).toHaveLength(2);
    expect(tethered?.[0]).toBe(
      readOrCreate<string>(lane, ["task", "t1"], external),
    );

    const written = other.set(["task", "t1"], "client");

    expect(publishedBy(snapshots)).toHaveLength(2);
    expect(publishedBy(snapshots)?.[1]).toBe(written);
    await expect(
      readOrCreate<string>(lane, ["task", "t1"], external),
    ).resolves.toEqual({ revision: expect.any(Number), data: "published" });
  });

  it("seats a client `set` where the value it overwrote sat", async () => {
    const lane = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "published" }],
    };

    hydrateMany(lane, snapshots);
    const written = lane.set(["task", "t1"], "client");

    // A write has no payload of its own behind it. It gets the one it
    // overwrote: the promise the entry now holds is the promise the payload
    // holds, so the write lives exactly as long as the value it replaced would
    // have.
    expect(publishedBy(snapshots)).toHaveLength(1);
    expect(publishedBy(snapshots)?.[0]).toBe(written);
    expect(readOrCreate<string>(lane, ["task", "t1"], external)).toBe(written);
    await expect(written).resolves.toEqual({
      revision: expect.any(Number),
      data: "client",
    });
  });

  it("seats an `update` the same way", async () => {
    const lane = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "published" }],
    };

    hydrateMany(lane, snapshots);
    const updated = lane.update<string>(
      ["task", "t1"],
      (task) => `${task}+edited`,
    );

    expect(publishedBy(snapshots)).toHaveLength(1);
    expect(publishedBy(snapshots)?.[0]).toBe(updated);
    await expect(updated).resolves.toEqual({
      revision: expect.any(Number),
      data: "published+edited",
    });
  });

  it("keeps one seat per key, so appends do not pile up behind the payload", async () => {
    const lane = createLane();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["tasks"], data: ["page-1"] }],
    };

    hydrateMany(lane, snapshots);

    // What `useInfiniteLane` does to a published first page: appends are
    // `update` calls. The payload ends up holding the entry's current value,
    // not the history of everything that stood there.
    lane.update<string[]>(["tasks"], (pages) => [...pages, "page-2"]);
    const appended = lane.update<string[]>(["tasks"], (pages) => [
      ...pages,
      "page-3",
    ]);

    expect(publishedBy(snapshots)).toHaveLength(1);
    expect(publishedBy(snapshots)?.[0]).toBe(appended);
    expect(readOrCreate<string[]>(lane, ["tasks"], external)).toBe(appended);
    await expect(appended).resolves.toEqual({
      revision: expect.any(Number),
      data: ["page-1", "page-2", "page-3"],
    });
  });

  it("loses a client write with the payload it overwrote", async () => {
    vi.useFakeTimers();

    const refresh = vi.fn();
    const lane = createLane({ refresh });
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "published" }],
    };

    hydrateMany(lane, snapshots);
    lane.set(["task", "t1"], "client");

    // The framework drops the payload: the bucket goes, and the seat the write
    // was sitting in goes with it. Nothing here distinguishes the write from
    // the publication — that is the rule.
    refs.collect();

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();

    expect(waiting.status).toBe("pending");
    // The shell still says an owner fills this key, so the read asks for it —
    // and the owner is re-fetching this data anyway, having dropped the payload.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("moves to the new payload when the key is published again", async () => {
    const lane = createLane();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    };

    hydrateMany(lane, first);
    hydrateMany(lane, second);

    const republished = readOrCreate<string>(lane, ["task", "t1"], external);

    expect(publishedBy(second)?.[0]).toBe(republished);
    expect(publishedBy(first)?.[0]).not.toBe(republished);

    const written = lane.set(["task", "t1"], "client");

    // A write goes where the value it overwrote came from. The superseded
    // payload keeps holding only what it published, and dies with the
    // navigation that dropped it — the write is not tied to it any more.
    expect(publishedBy(second)?.[0]).toBe(written);
    expect(publishedBy(first)).toHaveLength(1);
    expect(publishedBy(first)?.[0]).not.toBe(written);
    await expect(Promise.all(publishedBy(first) ?? [])).resolves.toEqual([
      { revision: expect.any(Number), data: "server-1" },
    ]);
  });

  it("holds a write that arrives after the payload is gone by its readers alone", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "published" }],
    };

    hydrateMany(lane, snapshots);
    refs.collect();

    // The edge of the rule: there is no seat left to take, so the write is
    // reachable from the slot and from whoever reads it, and from nothing else.
    const written = lane.set(["task", "t1"], "client");

    expect(readOrCreate<string>(lane, ["task", "t1"], external)).toBe(written);
    expect(publishedBy(snapshots)).toHaveLength(1);
    expect(publishedBy(snapshots)?.[0]).not.toBe(written);

    // When the readers go, so does it — and the read that finds it gone asks
    // the owner, which is where a dropped payload leaves this key anyway.
    refs.collect();

    const waiting = track(readOrCreate<string>(lane, ["task", "t1"], external));
    await flushMicrotasks();

    expect(waiting.status).toBe("pending");
  });
});

describe("an external reader", () => {
  it("shows the boundary's fallback until the key is published", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();

    await act(async () => {
      container.root.render(externalApp(lane));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("loading");

    // A reader that has not committed has no subscription to notify — but every
    // render attempt re-runs the `useState` initializer, so it reads whatever
    // the store holds by then. The publication lands, the tree re-renders, and
    // the read is the published value with no loader anywhere in sight.
    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "published" }],
    });

    await act(async () => {
      container.root.render(externalApp(lane));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("published");
  });

  it("resolves in its own boundary when a publication elsewhere lands", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    // The outside reader: its own Suspense boundary, no hydration boundary above
    // it, so nothing re-renders it when the payload lands and it holds no
    // subscription to be notified through. The wait it suspended on is the only
    // channel that reaches it.
    await act(async () => {
      container.root.render(outsideReaderApp(lane, snapshots));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toContain("loading");

    // Only as far as the publish macrotask — nowhere near the timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toContain("server-1");
    expect(container.element.textContent).not.toContain("loading");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mounts on the seed a boundary above it published", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    // The boundary suspends until its publish has landed, so the reader's first
    // read is already the seed: no wait is ever created.
    expect(container.element.textContent).toBe("server-1");
  });

  it("converges on a republish while it is visible", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, first, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, second, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
  });

  it("reveals a republish that landed while hidden with no fallback", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const container = mount();
    const first: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };
    const second: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, first, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, first, "hidden"));
      await settlePromiseHandlers();
    });

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, second, "hidden"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });

    const fallbacksBeforeReveal = fallbackRenders;

    // The reveal adopts the seed through the hydration source switch, in the
    // revealing render, so nothing loading is ever shown. This is where that
    // guarantee lives: `external` is what makes a reader a consumer of the
    // publication lineage at all, and a client-owned read of a seeded key
    // converges through the reveal reconciliation instead (see
    // activity.test.ts). The read *paths* still know nothing — the loader
    // decides who is woken, never how the entry is read.
    await act(async () => {
      container.root.render(hydratedExternalApp(lane, second, "visible"));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
    expect(fallbackRenders).toBe(fallbacksBeforeReveal);
    expect(valueElement(container.element).style.display).toBe("");
  });

  it("drops to the fallback when the revealed value has been collected", async () => {
    vi.useFakeTimers();

    const lane = createLane();
    const refs = controllableRefs();
    setExternalRefFactory(refs.factory);
    const container = mount();
    const snapshots: LaneHydrationSnapshots = {
      entries: [{ key: ["task", "t1"], data: "server-1" }],
    };

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settlePromiseHandlers();
    });
    expect(container.element.textContent).toBe("server-1");

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "hidden"));
      await settlePromiseHandlers();
    });

    // The store's copy is gone while the tree is hidden. The reader's own
    // committed promise is a strong reference in real life — this is the state
    // where the *store* has nothing to hand the reveal, which the layout
    // reconciliation turns into a fresh wait rather than a stale frame.
    refs.collect();

    await act(async () => {
      container.root.render(hydratedExternalApp(lane, snapshots, "visible"));
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toContain("loading");

    hydrateMany(lane, {
      entries: [{ key: ["task", "t1"], data: "server-2" }],
    });
    await act(async () => {
      await settlePromiseHandlers();
    });

    expect(container.element.textContent).toBe("server-2");
  });
});

/**
 * Type-level expectations. Never called — `pnpm typecheck` is what enforces
 * them, which is where the external read's shape is meant to fail: it carries no
 * option a loader would answer to, so writing one is an error at the definition.
 */
function typeExpectations(lane: Lane, enabled: boolean): void {
  type Task = { id: string; title: string };

  const detail = laneRead<Task>({ key: ["task", "t1"], loader: external });

  expectTypeOf(detail).toExtend<LaneExternalReadSpec<Task>>();
  // The key is tagged exactly as a client read's is, so the write side is
  // unchanged — and `T` travels to `useLane` through it.
  expectTypeOf(detail.key).toEqualTypeOf<LaneKeyOf<Task>>();

  // One return shape for every read: an external one carries `invalidate` and
  // `startInvalidationTransition` like any other, because it converges like any
  // other — the client says "stale", Lane asks the owner. The resolved value is
  // the ordinary `LaneRead` — `revision` included, though on an external entry
  // it is the publication's identity rather than the content's (see the type's
  // docs).
  expectTypeOf(useLane(detail)).toEqualTypeOf<LaneResult<Task>>();
  expectTypeOf(useLanePromise(detail)).toEqualTypeOf<Promise<LaneRead<Task>>>();

  const gated = laneRead<Task>({
    key: ["task", "t1"],
    loader: enabled ? external : undefined,
  });
  expectTypeOf(useLane(gated)).toEqualTypeOf<LaneGatedResult<Task>>();
  expectTypeOf(gated.key).toEqualTypeOf<LaneKeyOf<Task>>();

  // @ts-expect-error — freshness is a loader's business, and there is no loader.
  laneRead<Task>({ key: ["task", "t1"], loader: external, staleTime: 60_000 });
  // @ts-expect-error — same for every revalidation trigger,
  laneRead<Task>({ key: ["task", "t1"], loader: external, refetchOnMount: true });
  // @ts-expect-error — and for what a loader would be handed.
  laneRead<Task>({ key: ["task", "t1"], loader: external, loaderMeta: undefined });

  // @ts-expect-error — prefetch runs a loader; this read is filled by its owner.
  lane.prefetch(detail);

  // The write side is open and checked exactly as a client-owned key's is.
  lane.set(detail.key, { id: "t1", title: "Write" });
  // @ts-expect-error — against what the key says it holds.
  lane.set(detail.key, { id: "t1" });
}

void typeExpectations;

type Tracked<T> = {
  status: "pending" | "fulfilled" | "rejected";
  value: T | undefined;
  error: unknown;
};

/**
 * The promise cache protocol's fields, read off a promise — how "fulfilled at
 * creation, no microtask in between" is assertable at all (see
 * promise-protocol.test.ts).
 */
function stamps<T>(promise: Promise<T>): Promise<T> & { status?: string } {
  return promise as Promise<T> & { status?: string };
}

/**
 * Observe a promise without awaiting it — a wait that never settles is the
 * normal state here, so "still pending" has to be assertable.
 */
function track<T>(promise: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = {
    error: undefined,
    status: "pending",
    value: undefined,
  };

  promise.then(
    (value) => {
      tracked.status = "fulfilled";
      tracked.value = value;
    },
    (error: unknown) => {
      tracked.status = "rejected";
      tracked.error = error;
    },
  );

  return tracked;
}

async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

/**
 * The `WeakRef` stand-in: a reference the test can kill on demand. Collection is
 * not schedulable, but "the value is gone" is a state the store has to serve
 * correctly, and this is the only way to be at that moment on purpose.
 */
function controllableRefs() {
  const refs: { collected: boolean }[] = [];

  return {
    collect() {
      for (const ref of refs) {
        ref.collected = true;
      }
    },
    factory: <T extends object>(value: T) => {
      const ref = { collected: false };
      refs.push(ref);

      return { deref: () => (ref.collected ? undefined : value) };
    },
  };
}

function Probe({ spec }: { spec: LaneExternalReadSpec<string> }) {
  const { promise } = useLane(spec);

  return React.createElement(
    "div",
    { "data-testid": "value" },
    React.use(promise).data,
  );
}

function Fallback() {
  fallbackRenders += 1;

  return React.createElement("span", null, "loading");
}

const taskRead = laneRead<string>({ key: ["task", "t1"], loader: external });

function externalApp(lane: Lane): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Suspense,
      { fallback: React.createElement(Fallback) },
      React.createElement(Probe, { spec: taskRead }),
    ),
  });
}

/**
 * A reader with no publication above it, in a boundary of its own, beside a
 * hydration boundary that seeds its key. Nothing connects the two but the store.
 */
function outsideReaderApp(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    children: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(Probe, { spec: taskRead }),
      ),
      React.createElement(
        React.Suspense,
        { fallback: React.createElement("span", null, "publishing") },
        React.createElement(LaneHydration, {
          children: React.createElement("span", null, ""),
          snapshots,
        }),
      ),
    ),
  });
}

function hydratedExternalApp(
  lane: Lane,
  snapshots: LaneHydrationSnapshots,
  mode: Mode,
  refresh?: () => void,
): React.ReactElement {
  return React.createElement(LaneProvider, {
    lane,
    refresh,
    children: React.createElement(React.Activity, {
      children: React.createElement(
        React.Suspense,
        { fallback: React.createElement(Fallback) },
        React.createElement(LaneHydration, {
          children: React.createElement(Probe, { spec: taskRead }),
          snapshots,
        }),
      ),
      mode,
    }),
  });
}

function mount(): { element: HTMLDivElement; root: Root } {
  const element = document.createElement("div");
  const root = createRoot(element);

  document.body.append(element);
  roots.push(root);

  return { element, root };
}

function valueElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-testid="value"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error("Missing the probe's value element");
  }

  return element;
}
