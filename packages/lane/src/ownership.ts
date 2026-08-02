import type { LaneKey } from "./types";

/**
 * Who owns an entry, and what the store does about it — the small shared
 * vocabulary between the store and the `external` loader.
 *
 * It is its own module because the two sides need different parts of it and
 * must not need each other: the store asks whether a loader is external, throws
 * when a client writes to a key that is, and marks the read it supersedes with a
 * publication; the loader asks whether the abort that just landed *was* one.
 * Putting these three facts here is what lets `external.ts` — the waiting loader,
 * its timeout, and its error — stay out of every bundle that never mentions it.
 */

/**
 * The loaders that mean "somebody else fills this key".
 *
 * A set rather than a property on the loader: `external` is a value applications
 * pass around, and a marker hung on it would be part of its shape. Membership is
 * the whole classification — a loader is external or it is not, and nothing else
 * about it changes.
 */
const externalLoaders = new WeakSet<object>();

/** Declare a loader external. Called once, on `external` itself. */
export function markExternalLoader<T extends object>(loader: T): T {
  externalLoaders.add(loader);

  return loader;
}

/**
 * Whether this loader's key is filled from outside. Safe on anything — a
 * `WeakSet` reports non-objects (an absent loader, say) as absent.
 */
export function isExternalLoader(loader: unknown): boolean {
  return externalLoaders.has(loader as object);
}

/**
 * What using a client-side mutation on an externally published entry throws.
 *
 * An external entry's value is a copy of something its owner holds — an RSC
 * payload, a router's loader data — and Lane is the distribution layer for it,
 * not a second source of truth. Writing to it locally desynchronizes the two in
 * the one direction nothing repairs: the owner republishes on its own schedule
 * and overwrites the write, or it never republishes and the local edit outlives
 * the truth. Both are silent, so the write is not.
 */
export class LaneOwnershipError extends Error {
  readonly key: LaneKey;
  readonly keyId: string;

  constructor(key: LaneKey, keyId: string, operation: string) {
    super(
      // The explanation is development-only, the identification is not: this
      // error throws in production too, because it reports a write that silently
      // loses, but the paragraph saying why belongs to the build where someone
      // is reading it. The condition is written out literally and wraps the
      // whole literal, exactly as in `warnDev` — that is what a bundler folds,
      // and the prose then never reaches an application's users. (A helper that
      // returned the prose would not: the string would still be an argument, and
      // arguments ship.)
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

/**
 * The brand on a publication's abort reason. A symbol rather than a shape, so
 * nothing an application aborts with can be mistaken for a publication —
 * including an object that happens to carry a `value`.
 */
const PUBLICATION = Symbol("lane.publication");

export type LanePublication = { [PUBLICATION]: true; value: unknown };

/**
 * The abort reason that says "replaced by a publication, and here is what with".
 *
 * Reusing the abort channel is the point: the store already aborts the read it
 * is superseding, at exactly the moment the value exists, and a signal already
 * belongs to one read. Carrying the value on the reason means no second channel
 * between the store and the waiting loader — nothing registered, nothing to
 * clean up, and no way for the two to disagree about which read is being
 * settled.
 *
 * It carries the **raw published value**, not a `LaneRead`: the store wraps
 * whatever a loader resolves with, so handing it the wrapper would wrap it
 * twice. What a reader ends up holding is the same `{ data }` the entry's new
 * cache resolves to.
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
