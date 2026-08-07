"use client";

import { createLane, LaneProvider } from "use-lane";
import * as React from "react";
import type { WorkspaceCtx } from "@/lib/lane-meta";

/**
 * One lane for the route, created in the browser and handed the session as
 * `loaderMeta` — the same wiring `/lane` uses, and for the same reason: the
 * infinite read's page fetcher takes a cursor and nothing else, so the session
 * has to reach it from the lane rather than from the key.
 *
 * The provider is above `<LaneHydration>` in `page.tsx`, because the publication
 * needs a lane to publish into.
 */
export function InfiniteLaneProvider({
  ctx,
  children,
}: {
  ctx: WorkspaceCtx;
  children: React.ReactNode;
}) {
  const [lane] = React.useState(createLane);
  const meta = React.useMemo<WorkspaceCtx>(
    () => ({ teamId: ctx.teamId, userId: ctx.userId }),
    [ctx.teamId, ctx.userId],
  );

  return (
    <LaneProvider lane={lane} loaderMeta={meta}>
      {children}
    </LaneProvider>
  );
}
