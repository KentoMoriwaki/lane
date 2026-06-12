"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      {children}
    </TooltipProvider>
  );
}
