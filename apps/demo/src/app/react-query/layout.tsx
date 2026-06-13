"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { Toaster } from "@/app/react-query/components/ui/sonner";
import { TooltipProvider } from "@/app/react-query/components/ui/tooltip";
import { getQueryClient } from "@/app/react-query/get-query-client";

/**
 * Route-level providers for the TanStack Query variant: a per-request/singleton
 * QueryClient (filled by the page's HydrationBoundary), plus Tooltip + Toaster.
 * Each variant owns its providers so the two are fully self-contained.
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
