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
        // Hydrated data is fresh enough for the first render, and most of the
        // cache is catalogue data (teams, projects, labels, members) that only
        // changes when someone edits it — so the default is to refetch on demand
        // (refresh control, mutations, team switches) rather than on mount or
        // focus. The board's own reads opt back in; see `query-options.ts`.
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
