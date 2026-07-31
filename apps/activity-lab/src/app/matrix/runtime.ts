import { createLane, type Lane } from "use-lane";
import { createAgitator, type Agitator, type AgitatorKind } from "@/lab/agitator";
import type { FrameRecorder } from "@/lab/frame-recorder";
import { createLabLoader, type LabLoader, type LabLoaderMode } from "@/lab/loader";
import { labLog } from "@/lab/log";

export type QuadrantId = "P" | "A" | "H" | "AH";

export type KeyId = "a" | "b";

export const KEY_A = ["mx", "a"] as const;
export const KEY_B = ["mx", "b"] as const;

export function keyOf(which: KeyId) {
  return which === "a" ? KEY_A : KEY_B;
}

/**
 * `data-probe-value` suffixes of the probes that read each key — how a remove
 * captures "the value the store just forgot" for the FrameStrip flag without a
 * lane introspection API (the store cannot be read synchronously through the
 * public surface, but the committed DOM can).
 */
export const PROBE_SUFFIXES: Record<KeyId, readonly string[]> = {
  a: ["outside", "a1", "a1-memo", "a2", "all:0"],
  b: ["b", "all:1"],
};

export type LocalAgitationKind = Exclude<AgitatorKind, "contextTick">;

export type QuadrantRuntime = {
  id: QuadrantId;
  title: string;
  hasActivity: boolean;
  hasHydration: boolean;
  lane: Lane;
  loader: LabLoader;
  agitator: Agitator;
  /** Values captured at remove time; frames still showing them are flagged red. */
  deadValues: Set<string>;
  /** Set by the mounted Quadrant so the shared panel can clear all strips. */
  recorder: FrameRecorder | null;
  /**
   * Set by the mounted AgitatedZone. The kit's `RenderAgitator` returns its
   * `children` prop unchanged, so a bump re-renders only the wrapper — the
   * identical child element bails out of reconciliation and `useLane` never
   * re-runs. The zone owns the probe elements itself, which is what makes an
   * urgent/flushSync/transition bump actually reach the reader.
   */
  localBump: ((kind: LocalAgitationKind) => void) | null;
};

const DEFS: readonly {
  id: QuadrantId;
  title: string;
  hasActivity: boolean;
  hasHydration: boolean;
}[] = [
  { id: "P", title: "plain", hasActivity: false, hasHydration: false },
  { id: "A", title: "Activity", hasActivity: true, hasHydration: false },
  { id: "H", title: "Hydration", hasActivity: false, hasHydration: true },
  { id: "AH", title: "Activity + Hydration", hasActivity: true, hasHydration: true },
];

export function createRuntimes(
  loaderMode: LabLoaderMode = "auto",
  loaderDelay = 200,
): QuadrantRuntime[] {
  return DEFS.map((def) => ({
    ...def,
    lane: createLane(),
    loader: createLabLoader(`mx:${def.id}`, {
      mode: loaderMode,
      delay: loaderDelay,
    }),
    agitator: createAgitator(`matrix:${def.id}:agi`),
    deadValues: new Set<string>(),
    recorder: null,
    localBump: null,
  }));
}

export function agitateQuadrant(runtime: QuadrantRuntime, kind: AgitatorKind) {
  if (kind === "contextTick") {
    runtime.agitator.agitate(kind);
    return;
  }

  labLog.push(
    `matrix:${runtime.id}:agi`,
    "custom",
    `agitate:${kind}${runtime.localBump === null ? " (zone unmounted)" : ""}`,
  );
  runtime.localBump?.(kind);
}
