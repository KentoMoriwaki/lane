"use client";

import { use } from "react";
import { useLane } from "use-lane";
import type { SearchResponse } from "@/server/search/schema";
import { searchKey, searchLoader } from "./search-lane";

/**
 * The reader. One `useLane` on the topic, and `use(promise)` for the value.
 *
 * `topic` here is always the key these rows came from — a committed render and
 * the read it holds cannot disagree. Which topic was *clicked* is a different
 * fact, and it lives in the page above: while a transition is in flight the two
 * differ, and after a cancel they differ permanently, because the read that
 * would have made them agree was stopped.
 *
 * `#seq` is the server's own counter, so a value that came back from the cache
 * rather than the network keeps the sequence number it was first served with.
 */
export function SearchResults({
  topic,
  whenStale,
}: {
  topic: string;
  whenStale: "revalidate" | "refetch";
}) {
  const { promise, isInvalidationPending } = useLane({
    key: searchKey(topic),
    loader: searchLoader(topic),
    whenStale,
  });
  const { data, refreshError } = use(promise);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Results</h2>
        <p className="text-[11px] text-muted-foreground">
          showing: <span className="font-mono text-foreground">{data.q}</span> ·
          served #{data.seq}
          {isInvalidationPending ? " · transition pending" : ""}
        </p>
      </header>

      {refreshError ? (
        <p className="rounded-lg border border-rose/40 bg-rose/5 px-3 py-2 text-[11px] text-rose">
          refreshError:{" "}
          {refreshError instanceof Error
            ? refreshError.message
            : String(refreshError)}
        </p>
      ) : null}

      <Rows data={data} />
    </section>
  );
}

function Rows({ data }: { data: SearchResponse }) {
  if (data.rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-surface px-3 py-8 text-center text-xs text-muted-foreground">
        Nothing matches “{data.q}”.
      </p>
    );
  }

  return (
    <ol className="divide-y rounded-lg border bg-surface">
      {data.rows.map((row) => (
        <li
          key={row.id}
          className="flex items-baseline justify-between gap-3 px-3 py-1.5"
        >
          <span className="truncate text-xs">{row.title}</span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.project}
          </span>
        </li>
      ))}
    </ol>
  );
}
