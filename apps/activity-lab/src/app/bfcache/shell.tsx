"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { LaneProvider } from "use-lane";
import { FrameStrip, useFrameRecorder } from "@/lab/frame-recorder";
import { labLog } from "@/lab/log";
import { Timeline } from "@/lab/timeline";
import { bfReads } from "./reads";
import { bfcacheLane } from "./shared-lane";

const TARGETS = [
  { label: "shared", read: bfReads.shared() },
  { label: "list", read: bfReads.list() },
  { label: "detail/1", read: bfReads.detail("1") },
  { label: "detail/2", read: bfReads.detail("2") },
  { label: "detail/3", read: bfReads.detail("3") },
  { label: "static", read: bfReads.static() },
  { label: "cached", read: bfReads.cached() },
] as const;

const ROUTES = [
  { href: "/bfcache", label: "index" },
  { href: "/bfcache/list", label: "list" },
  { href: "/bfcache/detail/1", label: "detail/1" },
  { href: "/bfcache/detail/2", label: "detail/2" },
  { href: "/bfcache/detail/3", label: "detail/3" },
  { href: "/bfcache/static", label: "static" },
  { href: "/bfcache/cached", label: "cached" },
] as const;

export function BfcacheShell({ children }: { children: ReactNode }) {
  const [targetIndex, setTargetIndex] = useState(0);
  const setCount = useRef(0);
  const routeAreaRef = useRef<HTMLDivElement>(null);
  // "(hud)" only ever appears in values written by the set button below, so a
  // red frame marks the exact ticks a HUD-written value was in the route DOM.
  const recorder = useFrameRecorder(routeAreaRef, { flag: "(hud)" });

  const target = TARGETS[targetIndex] ?? TARGETS[0];

  const op = (name: string, run: () => void) => {
    labLog.push("bfcache:op", "lane-op", `${name} ${target.label}`);
    run();
  };

  return (
    <LaneProvider lane={bfcacheLane}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">/bfcache</span>
          {ROUTES.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className="rounded border border-zinc-300 bg-white px-2 py-1 font-mono hover:bg-zinc-100"
            >
              {route.label}
            </Link>
          ))}
          <span className="text-xs text-zinc-500">
            router bfcache keeps the last 3 inactive trees — visit a 4th route
            to evict the oldest
          </span>
        </nav>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-white p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            HUD (outside the route subtree — never hidden)
          </span>
          <select
            value={targetIndex}
            onChange={(event) => setTargetIndex(Number(event.target.value))}
            className="rounded border border-zinc-300 px-2 py-1 font-mono text-sm"
          >
            {TARGETS.map((entry, index) => (
              <option key={entry.label} value={index}>
                {entry.label} {JSON.stringify(entry.read.key)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => op("invalidate", () => bfcacheLane.invalidate(target.read.key))}
            className="rounded border border-zinc-400 bg-white px-3 py-1 text-sm font-semibold hover:bg-zinc-100"
          >
            invalidate
          </button>
          <button
            type="button"
            onClick={() => op("remove", () => bfcacheLane.remove(target.read.key))}
            className="rounded border border-rose-400 bg-white px-3 py-1 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            remove
          </button>
          <button
            type="button"
            onClick={() =>
              op("set", () =>
                bfcacheLane.set(
                  target.read.key,
                  `${target.label} set#${++setCount.current} (hud)`,
                ),
              )
            }
            className="rounded border border-emerald-400 bg-white px-3 py-1 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            set
          </button>
        </div>

        <div
          ref={routeAreaRef}
          className="rounded-lg border border-zinc-300 bg-zinc-100 p-3"
        >
          {children}
        </div>

        <FrameStrip recorder={recorder} label="route subtree (red = (hud) value in DOM)" />
        <Timeline channels={["bfcache"]} />
      </div>
    </LaneProvider>
  );
}
