"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { labLog } from "@/lab/log";

// The token candidate for reveals that stream no payload (plain back, static,
// fresh-cached routes): a hidden tree that keeps receiving pathname context
// updates sees prev !== current on the render that reveals it. This probe runs
// the exact pattern-B mechanism — prev held in state, compared during render —
// and logs what it observes, so the two open questions decide themselves:
// (a) do pathname updates reach the hidden tree at all (render logged with a
// foreign path while effects are down), and (b) does the reveal render see the
// flip back (TOKEN-FIRE with path === own before passive-mount returns).
// Finding in itself (build-time, 16.3.0-preview.10): under cacheComponents,
// `usePathname()` is URL data that "is only available at runtime" — a dynamic
// route fails `next build` if a client component calls it outside <Suspense>
// (digest CLIENT_HOOK_DYNAMIC). Any token built on it therefore lives below a
// Suspense boundary by construction; the exported probe carries its own.
function PathnameProbeInner({ route }: { route: string }) {
  const pathname = usePathname();
  const channel = `bfcache:${route}:pathname`;

  // First render pins "own": for a route subtree that is the path it was
  // mounted under. Never updated — a probe only ever lives in one route.
  const ownPath = useRef(pathname);

  // Effects are torn down while hidden and remount only after the reveal
  // paints, so live=0 marks exactly the renders pattern B must work in:
  // hidden re-renders, the reveal render itself, and initial mount.
  const effectsLive = useRef(false);

  const [prevPathname, setPrevPathname] = useState(pathname);
  const tokenFired = prevPathname !== pathname;
  if (tokenFired) {
    setPrevPathname(pathname);
  }

  labLog.push(
    channel,
    "render",
    `path=${pathname} prev=${prevPathname} live=${effectsLive.current ? 1 : 0}` +
      (tokenFired
        ? pathname === ownPath.current
          ? " TOKEN-FIRE (returned-to-own)"
          : " TOKEN-FIRE (away)"
        : ""),
  );

  useEffect(() => {
    effectsLive.current = true;
    labLog.push(channel, "passive-mount");
    return () => {
      effectsLive.current = false;
      labLog.push(channel, "passive-cleanup");
    };
  }, [channel]);

  return (
    <div
      className="font-mono text-[10px] text-zinc-500"
      data-pathname-probe={route}
    >
      pathname: {pathname} (own {ownPath.current})
    </div>
  );
}

function PathnameFallback({ route }: { route: string }) {
  labLog.push(`bfcache:${route}:pathname`, "custom", "url-suspended render");

  return (
    <div className="font-mono text-[10px] text-orange-600">pathname: …</div>
  );
}

export function PathnameProbe({ route }: { route: string }) {
  return (
    <Suspense fallback={<PathnameFallback route={route} />}>
      <PathnameProbeInner route={route} />
    </Suspense>
  );
}
