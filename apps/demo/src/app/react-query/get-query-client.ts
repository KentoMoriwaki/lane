import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

/**
 * One QueryClient per request on the server, and a single long-lived client in
 * the browser. This is the standard Next App Router + React Query setup: the
 * server prefetches and dehydrates, the browser hydrates and then owns the
 * cache for the rest of the session.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Hydrated data is fresh enough for the first render; we refetch on
        // demand (refresh control, mutations, team switches) rather than
        // aggressively on mount/focus.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      dehydrate: {
        // Also ship in-flight queries so the client can take over a pending
        // fetch instead of restarting it.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) {
    return makeQueryClient();
  }

  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }

  return browserQueryClient;
}
