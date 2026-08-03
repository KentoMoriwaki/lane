"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppRouterLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
