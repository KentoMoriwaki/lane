"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/app/lane/components/ui/sonner";
import { TooltipProvider } from "@/app/lane/components/ui/tooltip";

/**
 * Route-level providers for the use-lane variant. Tooltip + Toaster live here
 * (not in the root layout) so each variant is fully self-contained.
 */
export default function LaneLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
