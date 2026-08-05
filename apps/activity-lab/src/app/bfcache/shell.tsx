"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { LaneOwnershipError, LaneProvider } from "use-lane";
import { FrameStrip, useFrameRecorder } from "@/lab/frame-recorder";
import { labLog } from "@/lab/log";
import { Timeline } from "@/lab/timeline";
import { revalidateListAction } from "./actions";
import { PathnameProbe } from "./pathname-probe";
import { bfClient, bfPublished } from "./reads";
import { bfcacheLane } from "./shared-lane";

// Both ownerships are selectable, and the published half is deliberately left
// operable: pressing `set` on a key the server owns and reading REFUSED in the
// Timeline is one of the things this HUD is for. Only the client-owned half can
// actually be written from here, which is the whole distinction.
const TARGETS = [
  { label: "shared", owner: "published", read: bfPublished.shared() },
  { label: "list", owner: "published", read: bfPublished.list() },
  { label: "detail/1", owner: "published", read: bfPublished.detail("1") },
  { label: "detail/2", owner: "published", read: bfPublished.detail("2") },
  { label: "detail/3", owner: "published", read: bfPublished.detail("3") },
  { label: "static", owner: "published", read: bfPublished.static() },
  { label: "cached", owner: "published", read: bfPublished.cached() },
  { label: "client/list", owner: "client", read: bfClient.own("list") },
  {
    label: "client/detail/1",
    owner: "client",
    read: bfClient.own("detail/1"),
  },
  { label: "photo/1", owner: "client", read: bfClient.photo("1") },
] as const;

const ROUTES = [
  { href: "/bfcache", label: "index" },
  { href: "/bfcache/list", label: "list" },
  { href: "/bfcache/detail/1", label: "detail/1" },
  { href: "/bfcache/detail/2", label: "detail/2" },
  { href: "/bfcache/detail/3", label: "detail/3" },
  { href: "/bfcache/static", label: "static" },
  { href: "/bfcache/cached", label: "cached" },
  { href: "/bfcache/photo/1", label: "photo/1 (intercepted)" },
] as const;

export function BfcacheShell({
  children,
  modal,
}: {
  children: ReactNode;
  modal?: ReactNode;
}) {
  const [targetIndex, setTargetIndex] = useState(0);
  const setCount = useRef(0);
  const routeAreaRef = useRef<HTMLDivElement>(null);
  // "(hud)" only ever appears in values written by the set button below, so a
  // red frame marks the exact ticks a HUD-written value was in the route DOM.
  const recorder = useFrameRecorder(routeAreaRef, { flag: "(hud)" });

  const target = TARGETS[targetIndex] ?? TARGETS[0];

  const op = (name: string, run: () => void) => {
    labLog.push("bfcache:op", "lane-op", `${name} ${target.label}`);

    try {
      run();
    } catch (error) {
      if (error instanceof LaneOwnershipError) {
        // The store refusing a client write to a key the server publishes. It
        // is a result, not a crash — recorded on the same channel as the op it
        // answers, so the Timeline shows the attempt and the refusal adjacent.
        labLog.push(
          "bfcache:op",
          "lane-op",
          `${name} ${target.label} REFUSED — published key`,
        );
        return;
      }

      throw error;
    }
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
          {/* Control: the shell is never hidden, so this one shows how a
              visible pathname consumer renders on every navigation. */}
          <PathnameProbe route="hud" />
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
                {entry.owner === "published" ? "pub" : "own"} · {entry.label}{" "}
                {JSON.stringify(entry.read.key)}
              </option>
            ))}
          </select>
          <span
            className={
              target.owner === "published"
                ? "rounded bg-sky-100 px-2 py-1 font-mono text-[10px] font-bold text-sky-800"
                : "rounded bg-emerald-100 px-2 py-1 font-mono text-[10px] font-bold text-emerald-800"
            }
          >
            {target.owner === "published"
              ? "server-owned — writes refused"
              : "client-owned — writes apply"}
          </span>
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
          <button
            type="button"
            onClick={() => {
              labLog.push(
                "bfcache:op",
                "lane-op",
                "revalidatePath /bfcache/list (next layer)",
              );
              void revalidateListAction();
            }}
            className="rounded border border-sky-400 bg-white px-3 py-1 text-sm font-semibold text-sky-700 hover:bg-sky-50"
          >
            next: revalidatePath(list)
          </button>
        </div>

        <div
          ref={routeAreaRef}
          className="rounded-lg border border-zinc-300 bg-zinc-100 p-3"
        >
          {children}
          {/* The @modal slot renders inside the recorded route area so the
              FrameStrip sees modal content too. Not styled as an overlay —
              slot mechanics, not presentation, are what's under observation. */}
          {modal}
        </div>

        <FrameStrip recorder={recorder} label="route subtree (red = (hud) value in DOM)" />
        <Timeline channels={["bfcache"]} />
      </div>
    </LaneProvider>
  );
}
