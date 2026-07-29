import type {
  CursorMode,
  CursorResolution,
  FeedAuthor,
  FeedItem,
  FeedSort,
} from "./schema";

/**
 * The lab dataset: ~500 rows generated in module scope, deterministically.
 *
 * Determinism matters more than it looks. Every reload has to produce the same
 * ids, titles and timestamps, otherwise "did this row move?" is unanswerable —
 * so the generator is a hash of the row index, never `Math.random()`. Rows are
 * dated backwards from a fixed epoch (index 0 is the newest), which makes the
 * seed index and the `newest` sort order the same thing, and lets the UI detect
 * a gap or a duplicate purely from the numbers printed on the rows.
 *
 * The array is mutable: the lab's whole reason to exist is watching what
 * happens to a paginated list when the underlying collection changes under it.
 * State is parked on `globalThis` so Next's dev-time module reloading doesn't
 * silently reset the dataset in the middle of an experiment. On a serverless
 * deployment the state is per-instance and resets on cold starts — fine for a
 * lab, and the reason nothing here is wired into the product routes.
 */

const SEED_SIZE = 500;
/** Fixed point in time so the generated `createdAt` values never move. */
const SEED_EPOCH_MS = Date.UTC(2026, 0, 12, 9, 0, 0);
const SEED_STEP_MS = 7 * 60_000;

const AUTHORS: FeedAuthor[] = [
  { id: "a1", name: "Aoi Tanaka", initials: "AT", color: "#3b6fe0" },
  { id: "a2", name: "Ben Carter", initials: "BC", color: "#2f8f6a" },
  { id: "a3", name: "Chioma Eze", initials: "CE", color: "#c47d20" },
  { id: "a4", name: "Daniel Kim", initials: "DK", color: "#d6456b" },
  { id: "a5", name: "Elena Ruiz", initials: "ER", color: "#647084" },
  { id: "a6", name: "Farid Aziz", initials: "FA", color: "#7a5bd6" },
  { id: "a7", name: "Grace Park", initials: "GP", color: "#0e8f95" },
  { id: "a8", name: "Hiroshi Sato", initials: "HS", color: "#b8543f" },
];

const TITLE_VERBS = [
  "Rebuilding",
  "Measuring",
  "Retiring",
  "Streaming",
  "Batching",
  "Auditing",
  "Profiling",
  "Untangling",
  "Draining",
  "Replaying",
  "Sharding",
  "Backfilling",
];

const TITLE_SUBJECTS = [
  "the ingest pipeline",
  "cursor pagination",
  "the render budget",
  "cold-start latency",
  "the mutation queue",
  "stale cache entries",
  "the transition boundary",
  "our retry policy",
  "the hydration path",
  "list virtualisation",
  "background refetches",
  "the suspense fallback",
];

const TITLE_TAILS = [
  "without a rewrite",
  "one page at a time",
  "before the freeze",
  "on a slow network",
  "under real load",
  "with fewer round trips",
  "in a single transition",
  "and keeping the old screen",
];

const BODY_OPENERS = [
  "Notes from the last review:",
  "Short write-up:",
  "Field report:",
  "Follow-up:",
  "Draft, not final:",
  "Summary for the thread:",
];

const BODY_CLAUSES = [
  "the first page arrives fast but every subsequent page waits on the one before it",
  "the accumulated list survived the refetch, the scroll position did not",
  "a row inserted at the head shifted every window by exactly one",
  "the anchor row was deleted, so the server fell back to a positional guess",
  "three requests overlapped and the last one to resolve won",
  "the cache kept the pages while the component was unmounted",
  "invalidation marked the query stale but nothing refetched until it remounted",
  "the error surfaced on page four and the first three stayed on screen",
  "the sort key changed and the accumulated pages were dropped on the floor",
  "sequential refetch cost us five round trips for one changed row",
];

/** A deterministic 32-bit mix. Same index in, same row out, forever. */
function hash32(value: number): number {
  let x = (value + 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97) >>> 0;
  x ^= x >>> 15;
  return x >>> 0;
}

/**
 * Mixed twice: hashing `index * k + salt` directly left adjacent rows sharing
 * three of their four generated fields, which made neighbouring rows look
 * identical at a glance — the opposite of what a list you are inspecting for
 * duplicates needs.
 */
function pick<T>(list: readonly T[], index: number, salt: number): T {
  return list[hash32((hash32(index) + Math.imul(salt, 0x9e3779b1)) >>> 0) % list.length]!;
}

function seedItem(index: number): FeedItem {
  const author = pick(AUTHORS, index, 1);
  const title = `#${String(index).padStart(3, "0")} · ${pick(TITLE_VERBS, index, 2)} ${pick(TITLE_SUBJECTS, index, 3)} ${pick(TITLE_TAILS, index, 4)}`;
  const body = `${pick(BODY_OPENERS, index, 5)} ${pick(BODY_CLAUSES, index, 6)}; ${pick(BODY_CLAUSES, index, 7)}.`;

  return {
    id: `item-${String(index).padStart(4, "0")}`,
    seedIndex: index,
    title,
    body,
    author,
    createdAt: new Date(SEED_EPOCH_MS - index * SEED_STEP_MS).toISOString(),
    updatedAt: null,
    origin: "seed",
    revision: 0,
  };
}

type FeedState = {
  items: FeedItem[];
  revision: number;
  sequence: number;
  created: number;
};

function createState(): FeedState {
  return {
    items: Array.from({ length: SEED_SIZE }, (_, index) => seedItem(index)),
    revision: 0,
    sequence: 0,
    created: 0,
  };
}

const globalScope = globalThis as typeof globalThis & {
  __laneInfiniteLabFeed?: FeedState;
};

const state = (globalScope.__laneInfiniteLabFeed ??= createState());

/** Monotonic, process-wide. Stamped on every response so the client can order them. */
export function nextSequence(): number {
  return ++state.sequence;
}

export function feedRevision(): number {
  return state.revision;
}

export function feedTotal(): number {
  return state.items.length;
}

function sortItems(sort: FeedSort): FeedItem[] {
  const copy = [...state.items];

  switch (sort) {
    case "oldest":
      return copy.sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    case "title":
      return copy.sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
    case "newest":
    default:
      return copy.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
  }
}

/**
 * The cursor payload. It is base64url'd on the way out and never parsed by the
 * client, so as far as the frontend is concerned it is an opaque string. It
 * carries *both* an anchor id and a positional snapshot: keyset mode uses the
 * anchor and keeps the offset only as a fallback for when the anchor row has
 * been deleted, offset mode ignores the anchor entirely.
 */
type CursorPayload = {
  v: 1;
  sort: FeedSort;
  mode: CursorMode;
  offset: number;
  anchorId: string | null;
};

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorPayload>;

    if (parsed.v !== 1 || typeof parsed.offset !== "number") {
      return null;
    }

    return {
      v: 1,
      sort: (parsed.sort ?? "newest") as FeedSort,
      mode: (parsed.mode ?? "keyset") as CursorMode,
      offset: parsed.offset,
      anchorId: parsed.anchorId ?? null,
    };
  } catch {
    return null;
  }
}

export type ReadPageArgs = {
  cursor: string | null;
  limit: number;
  sort: FeedSort;
  cursorMode: CursorMode;
};

export type ReadPageResult = {
  items: FeedItem[];
  nextCursor: string | null;
  pageIndex: number;
  cursorResolution: CursorResolution;
  total: number;
};

export class InvalidCursorError extends Error {
  readonly code = "invalid_cursor";
}

export function readPage({
  cursor,
  limit,
  sort,
  cursorMode,
}: ReadPageArgs): ReadPageResult {
  const ordered = sortItems(sort);

  let start = 0;
  let resolution: CursorResolution = "start";

  if (cursor) {
    const payload = decodeCursor(cursor);

    if (!payload) {
      throw new InvalidCursorError("Cursor could not be decoded");
    }

    if (payload.sort !== sort) {
      // A cursor is only meaningful inside the ordering that produced it.
      // Clients that put the sort in their query key never hit this; the check
      // exists so that a client that *doesn't* fails loudly instead of silently
      // returning nonsense.
      throw new InvalidCursorError(
        `Cursor was issued for sort "${payload.sort}" but the request asked for "${sort}"`,
      );
    }

    if (cursorMode === "offset") {
      start = Math.min(Math.max(payload.offset, 0), ordered.length);
      resolution = "offset";
    } else {
      const anchorIndex = ordered.findIndex((item) => item.id === payload.anchorId);

      if (anchorIndex >= 0) {
        start = anchorIndex + 1;
        resolution = "anchor";
      } else {
        start = Math.min(Math.max(payload.offset, 0), ordered.length);
        resolution = "offset-fallback";
      }
    }
  }

  const items = ordered.slice(start, start + limit);
  const end = start + items.length;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      end < ordered.length && last
        ? encodeCursor({
            v: 1,
            sort,
            mode: cursorMode,
            offset: end,
            anchorId: last.id,
          })
        : null,
    // 1-based, derived from where the server actually started reading — not
    // from anything the client claimed.
    pageIndex: Math.floor(start / Math.max(limit, 1)) + 1,
    cursorResolution: resolution,
    total: ordered.length,
  };
}

/**
 * Insert a row at the head of the collection. Under the `newest` sort this is a
 * true head insert, which is exactly the shape of update that breaks positional
 * pagination: every later window shifts down by one.
 */
export function prependItem(title?: string): FeedItem {
  const created = ++state.created;
  const newestExisting = state.items.reduce(
    (max, item) => Math.max(max, Date.parse(item.createdAt)),
    0,
  );
  // Guarantee a strictly newer timestamp even when two inserts land in the
  // same millisecond, so `newest` stays a total order.
  const createdAt = new Date(Math.max(Date.now(), newestExisting + 60_000));

  const item: FeedItem = {
    id: `new-${String(created).padStart(3, "0")}`,
    seedIndex: null,
    title: title?.trim() || `NEW #${created} · inserted at the head`,
    body: `Created at runtime by the lab. Every window below this row shifts by one under a positional cursor.`,
    author: AUTHORS[created % AUTHORS.length]!,
    createdAt: createdAt.toISOString(),
    updatedAt: null,
    origin: "created",
    revision: 0,
  };

  state.items.unshift(item);
  state.revision += 1;

  return item;
}

export function deleteItem(id: string): FeedItem | null {
  const index = state.items.findIndex((item) => item.id === id);

  if (index < 0) {
    return null;
  }

  const [removed] = state.items.splice(index, 1);
  state.revision += 1;

  return removed ?? null;
}

export function updateItemTitle(id: string, title: string): FeedItem | null {
  const index = state.items.findIndex((item) => item.id === id);
  const current = state.items[index];

  if (!current) {
    return null;
  }

  const next: FeedItem = {
    ...current,
    title,
    updatedAt: new Date().toISOString(),
    revision: current.revision + 1,
  };

  state.items[index] = next;
  state.revision += 1;

  return next;
}

/** Back to the deterministic seed, so an experiment can be repeated exactly. */
export function resetFeed(): void {
  const fresh = createState();
  state.items = fresh.items;
  state.revision += 1;
  state.created = 0;
}

/** First item of the current `newest` ordering — the lab's default mutation target. */
export function headItem(sort: FeedSort): FeedItem | null {
  return sortItems(sort)[0] ?? null;
}
