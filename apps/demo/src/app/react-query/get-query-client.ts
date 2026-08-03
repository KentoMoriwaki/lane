import { QueryClient } from "@tanstack/react-query";

/**
 * The conventional SPA baseline has exactly one browser-owned QueryClient.
 * There is deliberately no per-request server client and no dehydration path.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Most of the cache is catalogue data (teams, projects, labels,
        // members) that only changes when someone edits it, so refetch on
        // demand (refresh, mutations, team switches) rather than on focus. The
        // board's own reads opt back in; see `query-options.ts`.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") {
    throw new Error("The SPA QueryClient can only be created in the browser");
  }

  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }

  return browserQueryClient;
}
