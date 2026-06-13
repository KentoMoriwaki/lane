"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { getQueryClient } from "@/rq/get-query-client";

/**
 * Route-level layout for the TanStack Query variant. The root layout already
 * provides Tooltip + Toaster; this only adds the QueryClientProvider that the
 * page's HydrationBoundary fills. In the browser getQueryClient() returns a
 * stable singleton; on the server a fresh client per request.
 */
export default function ReactQueryLayout({
  children,
}: {
  children: ReactNode;
}) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}
