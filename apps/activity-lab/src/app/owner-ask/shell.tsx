"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import { LaneProvider } from "use-lane";
import { FrameStrip, useFrameRecorder } from "@/lab/frame-recorder";
import { labLog } from "@/lab/log";
import { Timeline } from "@/lab/timeline";
import { refreshStore } from "./refresh-store";
import { ownerAskLane } from "./shared-lane";

// The driver reads the raw event array rather than the Timeline's clustered,
// capped DOM. Assigned at module evaluation on the client only; the log itself
// is the kit's singleton, so this adds a handle, not a second store.
if (typeof window !== "undefined") {
  (window as unknown as { __labLog?: typeof labLog }).__labLog = labLog;
}

const ROUTES = [
  { href: "/owner-ask", label: "index" },
  { href: "/owner-ask/a", label: "a (publishes K1 K2 K3)" },
  { href: "/owner-ask/b", label: "b (publishes nothing)" },
] as const;

// A leaf, and only a leaf: the shell renders the route subtree, so subscribing
// up there would re-render the readers this number is counting asks for.
function AskCount() {
  const count = useSyncExternalStore(
    refreshStore.subscribe,
    refreshStore.read,
    () => 0,
  );

  return (
    <span
      data-refresh-count={count}
      className={
        count === 0
          ? "rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-600"
          : "rounded bg-amber-100 px-2 py-1 font-mono text-xs font-bold text-amber-800"
      }
    >
      refresh() calls: {count}
    </span>
  );
}

export function OwnerAskShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const routeAreaRef = useRef<HTMLDivElement>(null);
  // The recorder lives here, outside every Activity boundary — inside, the
  // hide destroys its attach effect and the reveal window goes unrecorded.
  const recorder = useFrameRecorder(routeAreaRef, { flag: "SUSPENDED" });

  // What `<LaneProvider refresh>` installs on the lane: an external read that
  // finds a `published` shell with no settled value calls this once per tick,
  // out of render. Counting it here — rather than inferring asks from server
  // renders — is what separates "Lane asked twice" from "Next ran the same ask
  // twice".
  const refresh = useCallback(() => {
    refreshStore.bump();
    router.refresh();
  }, [router]);

  return (
    <LaneProvider lane={ownerAskLane} refresh={refresh}>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">/owner-ask</span>
          {ROUTES.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              data-nav={route.href}
              className="rounded border border-zinc-300 bg-white px-2 py-1 font-mono hover:bg-zinc-100"
            >
              {route.label}
            </Link>
          ))}
          <AskCount />
          <button
            type="button"
            data-op="reset"
            onClick={() => {
              refreshStore.reset();
              recorder.clear();
              labLog.clear();
            }}
            className="rounded border border-zinc-400 bg-white px-2 py-1 font-mono text-xs hover:bg-zinc-100"
          >
            reset counters + timeline + frames
          </button>
        </nav>

        <div
          ref={routeAreaRef}
          data-route-area=""
          className="rounded-lg border border-zinc-300 bg-zinc-100 p-3"
        >
          {children}
        </div>

        <FrameStrip
          recorder={recorder}
          label="route subtree (red = SUSPENDED painted)"
        />
        <Timeline channels={["owner-ask"]} />
      </div>
    </LaneProvider>
  );
}
