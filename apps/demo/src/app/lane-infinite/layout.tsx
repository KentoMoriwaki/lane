"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Route-level providers, so the spike is self-contained like every variant. */
export default function LaneInfiniteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
}
