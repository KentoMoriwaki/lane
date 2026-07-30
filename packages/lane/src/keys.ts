import type { LaneKey, LaneKeyOf } from "./types";

export function serializeKey(key: LaneKey): string {
  return stableStringify(key);
}

/**
 * Declare what a key holds: the same array, typed as a {@link LaneKeyOf} so
 * `set` and `update` through it are checked.
 *
 * `laneRead` already tags the key of the read it describes, and that is the
 * usual source of a typed key. This is for the other half of the codebase — the
 * one that writes. A mutation path addresses entries; it has no business
 * importing fetchers (or the request context a fetcher needs) just to name one,
 * so a key factory can carry the types on its own:
 *
 * ```ts
 * export const taskKeys = {
 *   detail: (id: string) => laneKey<Task>(["task", id]),
 * };
 *
 * lane.set(taskKeys.detail(task.id), task);          // checked, no loader in sight
 * laneRead({ key: taskKeys.detail(id), loader: … }); // and the read reuses it
 * ```
 *
 * Passing a typed key to `laneRead` is not just reuse: the key's type and the
 * loader's result have to agree, or the read does not compile. That is the
 * colocation guarantee running in the other direction — a factory of keys and a
 * factory of reads can no longer drift apart.
 *
 * The type argument is required and unverified. `laneKey<Task>(["task", id])`
 * asserts that this key's entry holds a `Task`; nothing checks it against a
 * loader unless a `laneRead` brings them together. It is the one place in Lane
 * where you state a type instead of inferring one — which is why the loaded type
 * belongs on the read wherever a read exists.
 */
export function laneKey<T>(key: LaneKey): LaneKeyOf<T> {
  return key as LaneKeyOf<T>;
}

export function isPrefixKey(prefix: LaneKey, key: LaneKey): boolean {
  if (prefix.length > key.length) {
    return false;
  }

  return prefix.every(
    (segment, index) => stableStringify(segment) === stableStringify(key[index]),
  );
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? "Date(invalid)" : `Date(${value.toISOString()})`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported Lane key value: ${String(value)}`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
