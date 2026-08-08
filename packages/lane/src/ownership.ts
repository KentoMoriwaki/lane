import type { LaneKey } from "./types";

// Shared vocabulary between the store and the `external` loader, split out so
// neither needs the other — keeps external.ts out of bundles that never use it.

// A WeakSet rather than a property, so `external` — a value applications pass
// around — carries no marker in its shape.
const externalLoaders = new WeakSet<object>();

/** Declare a loader external. Called once, on `external` itself. */
export function markExternalLoader<T extends object>(loader: T): T {
  externalLoaders.add(loader);

  return loader;
}

/** Whether this loader's key is filled from outside. Safe on non-objects. */
export function isExternalLoader(loader: unknown): boolean {
  return externalLoaders.has(loader as object);
}

/**
 * Thrown when a client-side mutation targets an externally published entry.
 * The value is a copy of something its owner holds; a local write is either
 * overwritten by the next republish or outlives the truth — both silently, so
 * the write is not.
 */
export class LaneOwnershipError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;

  constructor(key: LaneKey, keyId: string, operation: string) {
    super(
      // Diagnosis in dev, identification in prod (this throws in prod too).
      // The env condition wraps the whole literal so bundlers fold the prose
      // out of production builds; a helper returning it would still ship it.
      typeof process !== "undefined" && process.env.NODE_ENV !== "production"
        ? `${keyId} is published externally, so \`${operation}\` is not the ` +
            "client's to call. Its owner publishes the key (an RSC payload, a " +
            "router's loader data) and republishes to change it; a client write " +
            "would be overwritten, or outlive the truth, without either side " +
            "noticing. For an optimistic edit, layer `useOptimistic` over the " +
            "read value instead of writing to the store."
        : `${keyId} is published externally, so \`${operation}\` is not the client's to call.`,
    );

    this.name = "LaneOwnershipError";
    this.key = key;
    this.keyId = keyId;
  }
}

// A symbol brand, so nothing an application aborts with can be mistaken for a
// publication — even an object that happens to carry a `value`.
const PUBLICATION = Symbol("lane.publication");

export type LanePublication = { [PUBLICATION]: true; value: unknown };

/**
 * Abort reason meaning "replaced by a publication, and here is what with" —
 * reusing the abort the store already fires when superseding a read avoids a
 * second channel. Carries the **raw published value**, not a `LaneRead`: the
 * store wraps what a loader resolves with, so a wrapper here would wrap twice.
 */
export function publicationReason(value: unknown): LanePublication {
  return { [PUBLICATION]: true, value };
}

export function isPublication(reason: unknown): reason is LanePublication {
  return (
    typeof reason === "object" &&
    reason !== null &&
    (reason as LanePublication)[PUBLICATION] === true
  );
}
