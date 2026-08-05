"use client";

import {
  memo,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  useLane,
  useLanesAll,
  type LaneExternalReadSpec,
  type LaneReadSpec,
} from "use-lane";
import { labLog } from "./log";

/**
 * Either ownership. The probe renders a value and its two pending flags, and
 * both read kinds have all three — they differ only in `invalidate`, which the
 * probe does not call. /bfcache mounts one of each side by side, so the type
 * has to admit both or the scene needs two probes that render identically.
 */
export type ProbeRead = LaneExternalReadSpec<string> | LaneReadSpec<string>;

export type ProbeProps = {
  channel: string;
  read: ProbeRead;
  label?: string;
};

function useLifecycleLog(channel: string) {
  useLayoutEffect(() => {
    labLog.push(channel, "layout-mount");
    return () => {
      labLog.push(channel, "layout-cleanup");
    };
  }, [channel]);

  useEffect(() => {
    labLog.push(channel, "passive-mount");
    return () => {
      labLog.push(channel, "passive-cleanup");
    };
  }, [channel]);
}

function ProbeFallback({ channel }: { channel: string }) {
  labLog.push(channel, "custom", "suspense-fallback render");

  return (
    <div className="animate-pulse rounded border-2 border-dashed border-orange-500 bg-orange-100 px-2 py-1 font-mono text-sm font-bold text-orange-700">
      SUSPENDED
    </div>
  );
}

function ProbeReader({ channel, read }: { channel: string; read: ProbeRead }) {
  // `useLane`'s overloads discriminate on the loader, and a union matches none
  // of them. Narrowed to the client shape for the call because the two results
  // differ only in `invalidate`: everything read below is on both.
  const result = useLane(read as LaneReadSpec<string>);

  labLog.push(
    channel,
    "render",
    `bg:${result.isBackgroundPending ? 1 : 0} tr:${result.isInvalidationPending ? 1 : 0}`,
  );
  useLifecycleLog(channel);

  const value = use(result.promise);

  return (
    <div className="font-mono text-sm">
      <span className="font-bold" data-probe-value={channel}>
        {value.data}
      </span>
      <span
        className={
          result.isBackgroundPending ? "ml-2 text-amber-600" : "ml-2 text-zinc-300"
        }
      >
        bg:{result.isBackgroundPending ? 1 : 0}
      </span>
      <span
        className={
          result.isInvalidationPending ? "ml-1 text-amber-600" : "ml-1 text-zinc-300"
        }
      >
        tr:{result.isInvalidationPending ? 1 : 0}
      </span>
      {value.refreshError !== undefined && (
        <span className="ml-2 text-red-600">refreshError:{String(value.refreshError)}</span>
      )}
    </div>
  );
}

export function Probe({ channel, read, label }: ProbeProps) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-2" data-probe={channel}>
      <div className="mb-1 text-[10px] text-zinc-500">{label ?? channel}</div>
      <Suspense fallback={<ProbeFallback channel={channel} />}>
        <ProbeReader channel={channel} read={read} />
      </Suspense>
    </div>
  );
}

function sameRead(a: ProbeRead, b: ProbeRead): boolean {
  if (a.loader !== b.loader) return false;
  if (JSON.stringify(a.key) !== JSON.stringify(b.key)) return false;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("key");
  keys.delete("loader");

  for (const key of keys) {
    if (
      (a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }

  return true;
}

// Same probe, but opted out of parent re-renders — the contrast case for the
// agitator: an urgent parent render must reach the plain Probe and skip this
// one. Inline `read` objects would defeat `memo`, so props are compared by
// content (key by serialization, options shallowly).
export const MemoProbe = memo(
  Probe,
  (prev, next) =>
    prev.channel === next.channel &&
    prev.label === next.label &&
    sameRead(prev.read, next.read),
);

export type ProbeAllProps = {
  channel: string;
  /** Keep this array referentially stable across renders (useMemo/useState). */
  reads: readonly LaneReadSpec<string>[];
  label?: string;
};

function ProbeAllReader({ channel, reads }: { channel: string; reads: readonly LaneReadSpec<string>[] }) {
  const promise = useLanesAll(reads);

  labLog.push(channel, "render", `members:${reads.length}`);
  useLifecycleLog(channel);

  const values = use(promise);

  return (
    <div className="font-mono text-sm">
      {values.map((value, index) => (
        <span key={index} className="mr-2 font-bold" data-probe-value={`${channel}:${index}`}>
          {value.data}
        </span>
      ))}
    </div>
  );
}

export function ProbeAll({ channel, reads, label }: ProbeAllProps) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-2" data-probe={channel}>
      <div className="mb-1 text-[10px] text-zinc-500">
        {label ?? channel} (useLanesAll)
      </div>
      <Suspense fallback={<ProbeFallback channel={channel} />}>
        <ProbeAllReader channel={channel} reads={reads} />
      </Suspense>
    </div>
  );
}
