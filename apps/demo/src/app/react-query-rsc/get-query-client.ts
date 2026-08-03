import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

/**
 * One QueryClient per request on the server, and a single long-lived client in
 * the browser. Initial navigation and Next-converged mutation responses each
 * dehydrate a short-lived server client into that same browser store; ordinary
 * client reads still carry query functions for focus, retries, and uncached URL
 * states.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Hydrated data is fresh enough for the first render, and most of the
        // cache is catalogue data (teams, projects, labels, members) that only
        // changes when someone edits it. Mutations and manual refresh converge
        // through RSC hydration; browser queryFns remain available for retries
        // and uncached URL states. Board reads also opt into focus revalidation;
        // see `query-options.ts`.
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
