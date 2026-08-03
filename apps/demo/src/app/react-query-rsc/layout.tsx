"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getQueryClient } from "@/app/react-query-rsc/get-query-client";

/**
 * Route-level providers for the TanStack Query variant: one long-lived browser
 * QueryClient (repeatedly filled by the page's HydrationBoundary), plus Tooltip
 * + Toaster. Each variant owns its providers so the two are self-contained.
 */
export default function ReactQueryLayout({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200} skipDelayDuration={400}>
        {children}
        <Toaster />
      </TooltipProvider>
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}
