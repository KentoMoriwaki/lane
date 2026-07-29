"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearRequestLog, useRequestLog } from "./request-log";
import type { RequestLogEntry } from "./request-log";

/**
 * The observability panel: every HTTP request the page made, drawn on a shared
 * time axis so that concurrency is a shape rather than a claim.
 *
 * Requests are grouped into **waves** — a new wave starts when a request begins
 * more than `IDLE_GAP_MS` after everything before it finished. A wave is
 * therefore "one thing the user did", and its shape answers the question the
 * lab exists to ask:
 *
 *   - bars stacked in a staircase, each starting where the previous ended →
 *     the requests ran **sequentially**, each waiting on the one before it;
 *   - bars starting at the same offset → they were **in flight together**.
 *
 * The header states it numerically too: max concurrency, wall-clock span, and
 * the sum of the individual durations. For a sequential wave those last two are
 * roughly equal; for a parallel one the span is close to the slowest request.
 */

/** A pause longer than this ends a wave and starts a new one. */
const IDLE_GAP_MS = 250;

type Wave = {
  key: number;
  entries: RequestLogEntry[];
  start: number;
  end: number;
  maxConcurrency: number;
};

function buildWaves(entries: readonly RequestLogEntry[], now: number): Wave[] {
  const ordered = [...entries].sort((a, b) => a.startedAt - b.startedAt);
  const waves: Wave[] = [];

  for (const entry of ordered) {
    const end = entryEnd(entry, now);
    const current = waves[waves.length - 1];

    if (!current || entry.startedAt > current.end + IDLE_GAP_MS) {
      waves.push({
        key: entry.id,
        entries: [entry],
        start: entry.startedAt,
        end,
        maxConcurrency: 0,
      });
      continue;
    }

    current.entries.push(entry);
    current.end = Math.max(current.end, end);
  }

  for (const wave of waves) {
    wave.maxConcurrency = maxOverlap(wave.entries, now);
  }

  return waves;
}

/** Sweep over start/end events; ends are processed first at equal timestamps. */
function maxOverlap(entries: RequestLogEntry[], now: number): number {
  const events: Array<{ at: number; delta: number }> = [];

  for (const entry of entries) {
    events.push({ at: entry.startedAt, delta: 1 });
    events.push({ at: entryEnd(entry, now), delta: -1 });
  }

  events.sort((a, b) => a.at - b.at || a.delta - b.delta);

  let current = 0;
  let peak = 0;

  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }

  return peak;
}

/**
 * How long an entry has been running. Clamped at zero: a browser that stops
 * painting (a hidden tab) can leave the render clock behind a request that
 * started while it was asleep.
 */
function elapsed(entry: RequestLogEntry, now: number): number {
  return entry.durationMs ?? Math.max(now - entry.startedAt, 0);
}

function entryEnd(entry: RequestLogEntry, now: number): number {
  return entry.endedAt ?? Math.max(now, entry.startedAt);
}

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function formatClock(wallClock: number): string {
  const date = new Date(wallClock);
  return `${date.toLocaleTimeString(undefined, { hour12: false })}.${String(
    date.getMilliseconds(),
  ).padStart(3, "0")}`;
}

/**
 * A live clock for in-flight bars.
 *
 * The interval only exists to schedule re-renders; the timestamp itself is read
 * during render. Storing the clock in state instead would hand out a *stale*
 * reading on the render where a request first appears — and since bar widths
 * are `now - startedAt`, a stale reading draws negative durations.
 */
function useLiveClock(active: boolean): number {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = window.setInterval(() => setTick((count) => count + 1), 80);
    return () => window.clearInterval(timer);
  }, [active]);

  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const OUTCOME_BAR: Record<RequestLogEntry["outcome"], string> = {
  pending: "bg-amber/70",
  ok: "bg-cobalt",
  error: "bg-rose",
  aborted: "bg-slate-accent/50",
};

export function RequestTimeline() {
  const entries = useRequestLog();
  const hasPending = entries.some((entry) => entry.outcome === "pending");
  const tick = useLiveClock(hasPending);
  const waves = useMemo(() => buildWaves(entries, tick), [entries, tick]);
  const recentFirst = useMemo(() => [...waves].reverse(), [waves]);

  return (
    // Self-contained card: every variant gets the identical panel by rendering
    // `<RequestTimeline />` and nothing else.
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Request log</h2>
          <p className="text-xs text-muted-foreground">
            {entries.length} request{entries.length === 1 ? "" : "s"} ·{" "}
            {waves.length} wave{waves.length === 1 ? "" : "s"} · newest first
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={clearRequestLog}
          disabled={entries.length === 0}
        >
          Clear
        </Button>
      </div>

      {waves.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Nothing yet. Load a page — every request the page makes shows up here.
        </p>
      ) : (
        <ol className="flex min-h-0 flex-col gap-3 overflow-y-auto scrollbar-calm pr-1">
          {recentFirst.map((wave, index) => (
            <WaveCard
              key={wave.key}
              wave={wave}
              now={tick}
              ordinal={waves.length - index}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function WaveCard({
  wave,
  now,
  ordinal,
}: {
  wave: Wave;
  now: number;
  ordinal: number;
}) {
  const span = Math.max(wave.end - wave.start, 1);
  const sumDurations = wave.entries.reduce(
    (total, entry) => total + elapsed(entry, now),
    0,
  );
  const sequential = wave.entries.length > 1 && wave.maxConcurrency === 1;

  return (
    <li className="rounded-lg border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-semibold">
          Wave {ordinal}
          <span className="ml-1.5 font-normal text-muted-foreground">
            {wave.entries.length} request{wave.entries.length === 1 ? "" : "s"}
          </span>
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            sequential
              ? "bg-amber/15 text-amber"
              : wave.maxConcurrency > 1
                ? "bg-cobalt/15 text-cobalt"
                : "bg-muted text-muted-foreground",
          )}
        >
          {wave.entries.length === 1
            ? "single request"
            : sequential
              ? "sequential · max 1 in flight"
              : `overlapping · max ${wave.maxConcurrency} in flight`}
        </span>
      </div>

      <p className="mt-0.5 text-[10px] text-muted-foreground">
        span {formatMs(span)} · sum of durations {formatMs(sumDurations)}
        {wave.entries.length > 1
          ? sequential
            ? " — the wall clock is the sum, so nothing overlapped"
            : " — the wall clock is shorter than the sum, so requests overlapped"
          : ""}
      </p>

      <ol className="mt-2 space-y-1.5">
        {wave.entries.map((entry, index) => (
          <TimelineRow
            key={entry.id}
            entry={entry}
            previous={wave.entries[index - 1]}
            waveStart={wave.start}
            span={span}
            now={now}
          />
        ))}
      </ol>
    </li>
  );
}

function TimelineRow({
  entry,
  previous,
  waveStart,
  span,
  now,
}: {
  entry: RequestLogEntry;
  previous: RequestLogEntry | undefined;
  waveStart: number;
  span: number;
  now: number;
}) {
  const duration = elapsed(entry, now);
  const left = ((entry.startedAt - waveStart) / span) * 100;
  const width = Math.max((duration / span) * 100, 1.5);

  // How long after the *previous* request finished did this one start? A
  // sequential refetch shows a handful of milliseconds here; a parallel burst
  // shows a negative number (it started before the previous one ended).
  const offsetFromPrevious =
    previous && previous.endedAt !== null
      ? entry.startedAt - previous.endedAt
      : null;

  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px]">
        <span className="font-mono text-muted-foreground">
          {formatClock(entry.wallClock)}
        </span>
        <span className="font-medium text-foreground">{entry.label}</span>
        <span className="font-mono text-muted-foreground">
          {entry.cursorLabel}
        </span>
        <span className="ml-auto font-mono font-medium">
          {formatMs(duration)}
          {entry.outcome === "pending" ? "…" : ""}
        </span>
      </div>

      <div className="relative h-2 rounded-full bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 rounded-full",
            OUTCOME_BAR[entry.outcome],
            entry.outcome === "pending" && "animate-pulse",
          )}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        {entry.pageIndex !== null ? <Chip>page {entry.pageIndex}</Chip> : null}
        {entry.seq !== null ? <Chip>seq {entry.seq}</Chip> : null}
        {entry.status !== null ? (
          <Chip tone={entry.outcome === "error" ? "error" : "muted"}>
            {entry.status}
          </Chip>
        ) : null}
        {entry.itemCount !== null ? <Chip>{entry.itemCount} items</Chip> : null}
        {entry.cursorResolution ? <Chip>{entry.cursorResolution}</Chip> : null}
        {entry.nextCursorLabel ? (
          <Chip>next {entry.nextCursorLabel}</Chip>
        ) : null}
        {entry.outcome === "aborted" ? (
          <Chip tone="error">aborted</Chip>
        ) : null}
        {offsetFromPrevious !== null ? (
          <Chip tone={offsetFromPrevious < 0 ? "info" : "muted"}>
            {offsetFromPrevious < 0
              ? `started ${formatMs(-offsetFromPrevious)} before previous ended`
              : `started ${formatMs(offsetFromPrevious)} after previous ended`}
          </Chip>
        ) : null}
      </div>

      {entry.message && entry.outcome === "error" ? (
        <p className="text-[10px] text-rose">{entry.message}</p>
      ) : null}
    </li>
  );
}

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error" | "info";
}) {
  return (
    <span
      className={cn(
        "rounded border px-1 py-px font-mono",
        tone === "error" && "border-rose/30 bg-rose/10 text-rose",
        tone === "info" && "border-cobalt/30 bg-cobalt/10 text-cobalt",
        tone === "muted" && "border-border bg-muted/60",
      )}
    >
      {children}
    </span>
  );
}
