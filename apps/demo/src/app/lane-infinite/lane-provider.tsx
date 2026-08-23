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
 * One lane serves both rigs: the prop form needs it only for the infinite key,
 * and `/lane-infinite/late` also publishes into it.
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
