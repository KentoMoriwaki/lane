import type { LaneKey } from "./types";

export function serializeKey(key: LaneKey): string {
  return stableStringify(key);
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
