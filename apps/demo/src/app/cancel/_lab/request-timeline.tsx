"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SearchStats } from "@/server/search/schema";
import {
  clearRequestLog,
  useRequestLog,
  type RequestLogEntry,
  type RequestOutcome,
} from "./request-log";
import { fetchSearchStats, resetSearchStats } from "./search-client";

/**
 * What the network did, on one timeline.
 *
 * Bars are positioned from `performance.now()` start timestamps, so overlapping
 * requests overlap here too — the shape of the answer to "did cancelling stop
 * anything?" is visible before any of the numbers are read.
 *
 * The server counters below are the other half of that question. Aborting a
 * `fetch` closes the connection; whether the *server* stops is a property of the
 * stack, and this endpoint happens to look. `abandoned` is the work that was
 * actually saved rather than merely stopped being waited for.
 */

const OUTCOME_STYLES: Record<RequestOutcome, { bar: string; text: string }> = {
  aborted: { bar: "bg-amber/70", text: "text-amber" },
  error: { bar: "bg-rose/70", text: "text-rose" },
  ok: { bar: "bg-sage/70", text: "text-sage" },
  pending: { bar: "bg-cobalt/60", text: "text-cobalt" },
};

export function RequestTimeline() {
  const entries = useRequestLog();
  const pending = entries.some((entry) => entry.outcome === "pending");
  const [, setTick] = useState(0);
  const [stats, setStats] = useState<SearchStats | null>(null);

  // Only while something is in flight: a pending bar has to grow, and nothing
  // else on this panel changes on its own.
  useEffect(() => {
    if (!pending) {
      return;
    }

    const timer = setInterval(() => setTick((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, [pending]);

  // The counters only move when a request settles, so the log is the trigger.
  useEffect(() => {
    let cancelled = false;

    void fetchSearchStats().then((next) => {
      if (!cancelled) {
        setStats(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [entries]);

  const counts = {
    aborted: entries.filter((entry) => entry.outcome === "aborted").length,
    ok: entries.filter((entry) => entry.outcome === "ok").length,
    pending: entries.filter((entry) => entry.outcome === "pending").length,
  };

  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const windowStart = entries.length
    ? Math.min(...entries.map((entry) => entry.startedAt))
    : 0;
  const windowEnd = entries.length
    ? Math.max(...entries.map((entry) => entry.endedAt ?? now))
    : 1;
  const span = Math.max(windowEnd - windowStart, 1);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide">
            Request log
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {entries.length} total · {counts.ok} ok · {counts.aborted} aborted
            {counts.pending > 0 ? ` · ${counts.pending} in flight` : ""}
          </span>
        </div>

        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            clearRequestLog();
            void resetSearchStats().then(setStats);
          }}
        >
          Clear
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            No requests yet. Pick a topic — each one is its own key, and each key
            is its own read.
          </p>
        ) : (
          <ol className="divide-y">
            {entries.map((entry) => (
              <RequestRow
                key={entry.id}
                entry={entry}
                now={now}
                span={span}
                windowStart={windowStart}
              />
            ))}
          </ol>
        )}
      </div>

      <footer className="border-t px-3 py-2">
        <p className="text-[11px] font-medium">Server</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {stats
            ? `${stats.served} served · ${stats.abandoned} abandoned before the work finished`
            : "…"}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          A client-side abort only saves server work when the server is listening
          for it. This one is; most are not.
        </p>
      </footer>
    </section>
  );
}

function RequestRow({
  entry,
  now,
  span,
  windowStart,
}: {
  entry: RequestLogEntry;
  now: number;
  span: number;
  windowStart: number;
}) {
  const style = OUTCOME_STYLES[entry.outcome];
  const start = ((entry.startedAt - windowStart) / span) * 100;
  const end = (((entry.endedAt ?? now) - windowStart) / span) * 100;
  const width = Math.max(end - start, 1.5);

  return (
    <li className="grid grid-cols-[7rem_minmax(0,1fr)_5rem] items-center gap-2 px-3 py-1.5">
      <span className="truncate font-mono text-[11px]" title={entry.q}>
        {entry.q}
      </span>

      <span className="relative block h-2 rounded-full bg-surface">
        <span
          className={cn("absolute inset-y-0 rounded-full", style.bar)}
          style={{ left: `${start}%`, width: `${width}%` }}
        />
      </span>

      <span className="text-right">
        <span className={cn("block text-[11px] font-medium", style.text)}>
          {entry.outcome}
          {!entry.signalForwarded && entry.outcome !== "pending" ? "*" : ""}
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {entry.durationMs === null
            ? "…"
            : `${Math.round(entry.durationMs)} ms`}
          {entry.seq === null ? "" : ` · #${entry.seq}`}
        </span>
      </span>
    </li>
  );
}
