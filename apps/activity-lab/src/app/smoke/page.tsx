"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createLane, LaneProvider } from "use-lane";
import { labLog } from "@/lab/log";
import { createLabLoader } from "@/lab/loader";
import { Probe } from "@/lab/probe";
import { LabActivity } from "@/lab/shells";
import { Timeline } from "@/lab/timeline";

const KEY = ["smoke"];

export default function SmokePage() {
  const [lane] = useState(() => createLane());
  const [loads] = useState(() =>
    createLabLoader("smoke", { mode: "auto", delay: 300 }),
  );
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  // Mount the scene as a client island. Rendering it through SSR runs the
  // loader on the server, and selective hydration defers the probe's first
  // client render until an interaction — the hide click itself — so effects
  // would never have mounted before the hide being observed.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">/smoke</h1>
        <p className="text-sm text-zinc-600">
          Kit smoke test. Expected to be readable in the Timeline: hide runs the
          probe&apos;s passive-cleanup a beat after the activity event; reveal
          renders the probe before its passive-mount.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setMode((current) => (current === "visible" ? "hidden" : "visible"))
          }
          className="rounded border border-zinc-400 bg-white px-3 py-1 text-sm font-semibold hover:bg-zinc-100"
        >
          {mode === "visible" ? "hide" : "reveal"}
        </button>
        <button
          type="button"
          onClick={() => {
            labLog.push("smoke:op", "lane-op", "invalidate [smoke]");
            lane.invalidate(KEY);
          }}
          className="rounded border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-100"
        >
          invalidate
        </button>
        <span className="font-mono text-xs text-zinc-500">
          mode={mode} calls={loads.calls}
        </span>
      </div>

      {mounted ? (
        <LaneProvider lane={lane}>
          <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
              LabActivity ({mode})
            </div>
            <LabActivity mode={mode} channel="smoke:activity">
              <Probe
                channel="smoke:probe"
                read={{ key: KEY, loader: loads.loader }}
              />
            </LabActivity>
          </div>
        </LaneProvider>
      ) : (
        <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-400">
          booting client island…
        </div>
      )}

      <Timeline channels={["smoke", "loader:smoke"]} />

      <Link href="/" className="text-sm text-zinc-500 underline">
        back
      </Link>
    </main>
  );
}
