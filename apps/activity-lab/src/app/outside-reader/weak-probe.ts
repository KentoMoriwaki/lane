import { labLog } from "@/lab/log";

/**
 * The retention probe: our own `WeakRef` to every published value the scene has
 * seen, plus a `FinalizationRegistry` that says when one is actually collected.
 *
 * The lab cannot look inside a lane entry, and it must not hold the value it is
 * measuring — so it holds the *published data object* weakly and nothing else.
 * That object is what an external entry's promise resolves to, and it is the
 * same object the RSC payload carries, so its reachability is exactly the chain
 * the design delegates to: publisher's payload → publication tether → entry
 * slot, plus whatever committed readers hold.
 *
 * "Collected" is one-way and unschedulable, so both answers are reported as
 * facts: `alive` may mean "reachable by design" or "collectable but not yet
 * collected", and only the pressure button plus the store probe can tell those
 * apart.
 */

export type TrackedValue = {
  label: string;
  n: number;
  at: number;
  collectedAt: number | null;
};

type Tracked = TrackedValue & { ref: WeakRef<object> };

const tracked: Tracked[] = [];
const seen = new Set<string>();

const registry =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<string>((id) => {
        const entry = tracked.find((value) => `${value.label}#${value.n}` === id);

        if (entry && entry.collectedAt === null) {
          entry.collectedAt = performance.now();
        }

        labLog.push("outside:weakref", "custom", `FINALIZED ${id}`);
      })
    : undefined;

/**
 * Start watching a published value. Called from the reader's render, so it has
 * to be idempotent per value — the same publication is rendered many times.
 */
export function trackValue(label: string, n: number, value: object): void {
  const id = `${label}#${n}`;

  if (seen.has(id)) {
    return;
  }

  seen.add(id);
  tracked.push({ at: performance.now(), collectedAt: null, label, n, ref: new WeakRef(value) });
  registry?.register(value, id);
  labLog.push("outside:weakref", "custom", `track ${id}`);
}

/** Current liveness of everything tracked. Never returns the values themselves. */
export function readTracked(): readonly TrackedValue[] {
  return tracked.map((entry) => {
    const alive = entry.ref.deref() !== undefined;

    if (!alive && entry.collectedAt === null) {
      entry.collectedAt = performance.now();
      labLog.push(
        "outside:weakref",
        "custom",
        `deref()=undefined ${entry.label}#${entry.n}`,
      );
    }

    return {
      at: entry.at,
      collectedAt: entry.collectedAt,
      label: entry.label,
      n: entry.n,
    };
  });
}

export function clearTracked(): void {
  tracked.length = 0;
  seen.clear();
}

/**
 * Drive a major GC the only way a page can: allocate enough short-lived objects
 * that the collector has to run, yielding between rounds so the engine's
 * WeakRef keep-alive window (one job) closes and the finalization callbacks get
 * a chance to fire.
 */
export async function applyMemoryPressure(rounds = 40): Promise<number> {
  const started = performance.now();

  for (let round = 0; round < rounds; round += 1) {
    // Escapes analysis (assigned into an array that is itself dropped) and is
    // big enough to force promotions, so the old generation actually gets
    // swept rather than only the nursery.
    let sink: unknown[] = [];

    for (let i = 0; i < 200_000; i += 1) {
      sink.push({ i, pad: i.toString(36) });
    }

    sink = [];
    void sink;

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const ms = performance.now() - started;
  labLog.push(
    "outside:weakref",
    "custom",
    `pressure ${rounds} rounds in ${ms.toFixed(0)}ms`,
  );

  return ms;
}
