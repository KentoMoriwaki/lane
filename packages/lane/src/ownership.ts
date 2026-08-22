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
 * Thrown by `lane.prefetch` on an external read — the one operation an external
 * key still refuses. Everything else the client can do to an entry (`set`,
 * `update`, `invalidate`, `remove`) it can do to this one.
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
        ? `${keyId} is filled by its owner, so \`${operation}\` has no loader ` +
            "to run. Warming this key would mean asking the owner to render " +
            "again — a whole route for one key, before anything reads it. Let " +
            "the read ask when a reader needs the value: `useLane` on an " +
            "external key asks through the lane's `refresh` if the value is " +
            "gone, and waits for the publication if it is on its way."
        : `${keyId} is filled by its owner, so \`${operation}\` has no loader to run.`,
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
