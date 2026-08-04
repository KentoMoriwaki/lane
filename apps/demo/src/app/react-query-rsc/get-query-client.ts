import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

/**
 * One QueryClient per request on the server, and a single long-lived client in
 * the browser. Initial navigation and Next-converged mutation responses each
 * dehydrate a short-lived server client into that same browser store. As in the
 * Lane RSC variant, route publications own freshness; the browser store does not
 * independently refetch a hydrated generation on mount, focus, or reconnect.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Hydration is the authoritative publication channel. Infinity keeps
        // React Query from inventing a second freshness clock for that data;
        // mutations and manual refresh converge through a newer RSC payload.
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnMount: false,
        refetchOnReconnect: false,
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
