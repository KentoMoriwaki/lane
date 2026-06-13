"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Route-level providers for the client-only use-lane variant. The workspace
 * mounts its own LaneProvider and owns every read on the client (no server
 * prefetch); this just supplies Tooltip + Toaster.
 */
export default function LaneSpaLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
