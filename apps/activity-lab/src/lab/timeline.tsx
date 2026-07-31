"use client";

import { useSyncExternalStore } from "react";
import { labLog, type LabEvent, type LabEventKind } from "./log";

const EMPTY: readonly LabEvent[] = [];

const KIND_COLOR: Record<LabEventKind, string> = {
  render: "bg-sky-100 text-sky-800",
  "layout-mount": "bg-emerald-100 text-emerald-800",
  "layout-cleanup": "bg-emerald-50 text-emerald-600",
  "passive-mount": "bg-violet-100 text-violet-800",
  "passive-cleanup": "bg-violet-50 text-violet-600",
  "loader-call": "bg-amber-100 text-amber-800",
  "loader-settle": "bg-amber-50 text-amber-700",
  "lane-op": "bg-rose-100 text-rose-800",
  activity: "bg-zinc-200 text-zinc-800",
  custom: "bg-fuchsia-100 text-fuchsia-800",
};

function matches(event: LabEvent, channels: readonly string[] | undefined) {
  if (channels === undefined || channels.length === 0) {
    return true;
  }

  return channels.some(
    (channel) =>
      event.channel === channel || event.channel.startsWith(`${channel}:`),
  );
}

type Cluster = {
  start: number;
  events: LabEvent[];
};

function clusterize(
  events: readonly LabEvent[],
  gapMs: number,
): readonly Cluster[] {
  const clusters: Cluster[] = [];

  for (const event of events) {
    const last = clusters.at(-1);
    const lastEvent = last?.events.at(-1);

    if (last !== undefined && lastEvent !== undefined && event.t - lastEvent.t <= gapMs) {
      last.events.push(event);
    } else {
      clusters.push({ start: event.t, events: [event] });
    }
  }

  return clusters;
}

export function Timeline({
  channels,
  clusterGapMs = 10,
  maxClusters = 40,
  title = "Timeline",
}: {
  /** Exact channel names, or prefixes — `"matrix"` matches `"matrix:A+H"`. */
  channels?: readonly string[];
  clusterGapMs?: number;
  maxClusters?: number;
  title?: string;
}) {
  const events = useSyncExternalStore(
    labLog.subscribe,
    labLog.snapshot,
    () => EMPTY,
  );

  const filtered = events.filter((event) => matches(event, channels));
  const clusters = clusterize(filtered, clusterGapMs).slice(-maxClusters);
  const origin = filtered[0]?.t ?? 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
        <h2 className="text-sm font-semibold">
          {title}
          <span className="ml-2 font-normal text-zinc-400">
            {filtered.length} events
          </span>
        </h2>
        <button
          type="button"
          onClick={() => labLog.clear()}
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100"
        >
          clear
        </button>
      </div>
      <ol className="max-h-80 space-y-2 overflow-y-auto p-3 font-mono text-xs">
        {clusters.length === 0 ? (
          <li className="text-zinc-400">no events</li>
        ) : (
          clusters.map((cluster) => (
            <li key={cluster.start} className="rounded border border-zinc-100 bg-zinc-50 p-2">
              <div className="mb-1 text-[10px] text-zinc-500">
                +{(cluster.start - origin).toFixed(1)}ms
              </div>
              <ol className="space-y-0.5">
                {cluster.events.map((event, index) => (
                  <li key={`${event.t}-${index}`} className="flex items-baseline gap-2">
                    <span className="w-14 shrink-0 text-right text-[10px] text-zinc-400">
                      +{(event.t - cluster.start).toFixed(1)}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1 ${KIND_COLOR[event.kind]}`}
                    >
                      {event.kind}
                    </span>
                    <span className="shrink-0 text-zinc-500">{event.channel}</span>
                    {event.detail !== undefined && (
                      <span className="break-all text-zinc-700">{event.detail}</span>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
