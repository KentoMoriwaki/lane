"use client";

import { useEffect, useState } from "react";
import { createHashRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { LaneProvider } from "use-lane";
import { routes } from "./routes";
import { Boot } from "./shell";

/**
 * A hash-routed React Router v8 **Data mode** SPA, mounted as a client island
 * inside this Next.js route. React Router owns the `#/…` fragment; Next owns the
 * `/lane-router` pathname — they manage disjoint parts of the URL, so the two
 * routers never conflict. `createHashRouter` touches `window`, so it is created
 * only after mount (client-only); SSR renders the boot skeleton.
 */
function LaneRouterApp() {
  const [router] = useState(() => createHashRouter(routes));
  return (
    <LaneProvider>
      <RouterProvider router={router} />
    </LaneProvider>
  );
}

export default function LaneRouterPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {mounted ? <LaneRouterApp /> : <Boot />}
    </div>
  );
}
