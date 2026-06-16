"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Route-level providers for the Relay variant. The workspace mounts its own
 * RelayEnvironmentProvider and owns every read on the client (no server
 * prefetch); this just supplies Tooltip + Toaster, like the other variants.
 */
export default function RelayLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
