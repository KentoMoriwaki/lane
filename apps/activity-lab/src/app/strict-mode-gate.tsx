"use client";

import Link from "next/link";
import { StrictMode, useEffect, useState, type ReactNode } from "react";

// `?strict=1` is read after mount rather than via `useSearchParams`: the server
// tree must not depend on the URL, or hydration would reconcile against a
// different component tree (StrictMode wrapper present on one side only) and
// under `cacheComponents` the whole shell would fall into a Suspense fallback.
// The cost is one remount right after hydration when the flag is on.
export function StrictModeGate({ children }: { children: ReactNode }) {
  const [strict, setStrict] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("strict") === "1") {
      setStrict(true);
    }
  }, []);

  return (
    <>
      <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2 text-sm">
        <Link href="/" className="font-semibold">
          Activity Lab
        </Link>
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={strict}
            onChange={(event) => setStrict(event.target.checked)}
          />
          <span className={strict ? "font-semibold text-rose-600" : ""}>
            StrictMode {strict ? "on" : "off"}
          </span>
        </label>
      </header>
      {strict ? <StrictMode>{children}</StrictMode> : children}
    </>
  );
}
