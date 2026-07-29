import type { LaneKey, LaneTarget } from "./types";

export function serializeKey(key: LaneKey): string {
  return stableStringify(key);
}

/**
 * The key an exact-key operation addresses, from either form it accepts: a key,
 * or a read spec carrying one. A key is always an array and a spec never is, so
 * the two are told apart structurally — no marker property, nothing for a caller
 * to keep in sync.
 */
export function keyOf(target: LaneTarget): LaneKey {
  return isLaneKey(target) ? target : target.key;
}

export function isLaneKey(target: LaneTarget): target is LaneKey {
  return Array.isArray(target);
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
