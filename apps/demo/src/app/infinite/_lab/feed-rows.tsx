"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  FeedItem,
  FeedPageResponse,
  FeedSort,
} from "@/server/feed/schema";

/**
 * How a feed row and a page boundary look. Pure presentation over the server's
 * payload — nothing here knows what fetched the data or how the surrounding
 * list is modelled, so every variant renders identical rows and the visual
 * comparison between them stays about behaviour.
 */

export type RowAnnotation = {
  /** This id already appeared earlier in the accumulated list. */
  duplicate: boolean;
  /** Seed indices skipped between the previous row and this one. */
  gapBefore: number;
};

/**
 * Continuity analysis done on the client, from the numbers printed on the rows
 * — deliberately not trusting the server's own accounting. Seed rows are
 * numbered along the `newest` ordering, so under `newest`/`oldest` consecutive
 * rows must differ by exactly one. Runtime-created rows have no seed index and
 * simply break the chain without being counted as a gap.
 */
export function annotateItems(
  items: readonly FeedItem[],
  sort: FeedSort,
): RowAnnotation[] {
  const seen = new Set<string>();
  const annotations: RowAnnotation[] = [];
  const step = sort === "newest" ? 1 : sort === "oldest" ? -1 : 0;
  let previousSeed: number | null = null;

  for (const item of items) {
    const duplicate = seen.has(item.id);
    seen.add(item.id);

    let gapBefore = 0;
    if (step !== 0 && item.seedIndex !== null && previousSeed !== null) {
      const delta = (item.seedIndex - previousSeed) * step;
      if (delta > 1) {
        gapBefore = delta - 1;
      }
    }

    if (item.seedIndex !== null) {
      previousSeed = item.seedIndex;
    }

    annotations.push({ duplicate, gapBefore });
  }

  return annotations;
}

/** Counts derived from the annotations, for the strip above a list. */
export function integrityOf(annotations: readonly RowAnnotation[]) {
  return {
    duplicates: annotations.filter((row) => row.duplicate).length,
    skipped: annotations.reduce((total, row) => total + row.gapBefore, 0),
  };
}

export function ListIntegrity({
  annotations,
  children,
}: {
  annotations: readonly RowAnnotation[];
  children?: React.ReactNode;
}) {
  const { duplicates, skipped } = integrityOf(annotations);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {children}
      <span className={cn(duplicates > 0 && "text-rose")}>
        <strong className="font-mono">{duplicates}</strong> duplicate ids
      </span>
      <span className={cn(skipped > 0 && "text-amber")}>
        <strong className="font-mono">{skipped}</strong> seed indices skipped
      </span>
    </div>
  );
}

/**
 * The boundary between two pages, stamped with what the server said when it
 * served that page: its own page index, the sequence number, the dataset
 * revision, and how it resolved the cursor it was handed.
 */
export function PageSeparator({
  page,
  index,
}: {
  page: FeedPageResponse;
  index: number;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-y bg-muted/80 px-3 py-1 text-[10px] text-muted-foreground backdrop-blur">
      <span className="font-semibold text-foreground">page {index}</span>
      <span className="font-mono">server page {page.pageIndex}</span>
      <span className="font-mono">seq {page.seq}</span>
      <span className="font-mono">rev {page.revision}</span>
      <span className="font-mono">{page.cursorResolution}</span>
      <span className="ml-auto font-mono">
        {page.items.length} rows · total {page.total}
      </span>
    </div>
  );
}

export function FeedRow({
  item,
  annotation,
  busy,
  onRename,
  onDelete,
}: {
  item: FeedItem;
  annotation: RowAnnotation | undefined;
  busy: boolean;
  onRename: (item: FeedItem) => void;
  onDelete: (item: FeedItem) => void;
}) {
  return (
    <>
      {annotation && annotation.gapBefore > 0 ? (
        <li className="bg-amber/10 px-3 py-1 text-[10px] font-medium text-amber">
          {annotation.gapBefore} seed{" "}
          {annotation.gapBefore === 1 ? "index" : "indices"} skipped here
        </li>
      ) : null}
      <li
        className={cn(
          "flex gap-3 px-3 py-2.5",
          annotation?.duplicate && "bg-rose/10",
          busy && "opacity-50",
        )}
      >
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: item.author.color }}
        >
          {item.author.initials}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug">
              {item.title}
            </p>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                title="Rename this row (in place, no reordering)"
                onClick={() => onRename(item)}
                disabled={busy}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Delete this row"
                onClick={() => onDelete(item)}
                disabled={busy}
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          <p className="line-clamp-2 text-xs text-muted-foreground">
            {item.body}
          </p>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="font-mono">{item.id}</span>
            <span>{item.author.name}</span>
            <span className="font-mono">
              {new Date(item.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {item.revision > 0 ? (
              <span className="rounded bg-cobalt/10 px-1 font-mono text-cobalt">
                rev {item.revision}
              </span>
            ) : null}
            {item.origin === "created" ? (
              <span className="rounded bg-sage/10 px-1 font-mono text-sage">
                created at runtime
              </span>
            ) : null}
            {annotation?.duplicate ? (
              <span className="rounded bg-rose/15 px-1 font-mono text-rose">
                duplicate id
              </span>
            ) : null}
          </div>
        </div>
      </li>
    </>
  );
}

/**
 * The bounded, independently scrolling viewport a list lives in. Exported so an
 * auto-load sentinel can be observed against a real scroll container rather
 * than the page — but a variant is free to ignore it and scroll its own way.
 */
export const FEED_SCROLLER_CLASS =
  "max-h-[65vh] overflow-y-auto scrollbar-calm rounded-lg border bg-surface";
