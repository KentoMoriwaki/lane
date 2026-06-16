import { meros } from "meros/browser";
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  type FetchFunction,
  type GraphQLResponse,
} from "relay-runtime";

/**
 * The Relay environment for the workspace.
 *
 * One environment is created per active team (see `workspace-provider.tsx`), so
 * switching teams starts from a clean normalized store — the Relay equivalent of
 * the other variants clearing their cache on a team switch. Within a team the
 * store is long-lived: it normalizes every entity by `id`, which is what makes a
 * mutation update every view of a task without any cache-sync code.
 *
 * The network speaks GraphQL incremental delivery: it asks for
 * `multipart/mixed`, and when the server streams a `@defer` response it forwards
 * each chunk to Relay as it arrives, so deferred fragments resolve their own
 * Suspense boundaries independently of the shell.
 */

export type WorkspaceCtx = {
  userId: string;
  teamId: string;
};

const GRAPHQL_ENDPOINT = "/api/graphql";

function createFetch(ctx: WorkspaceCtx): FetchFunction {
  return (operation, variables) =>
    Observable.create<GraphQLResponse>((sink) => {
      void execute(operation.text, variables, ctx, sink);
    });
}

async function execute(
  query: string | null | undefined,
  variables: Record<string, unknown>,
  ctx: WorkspaceCtx,
  sink: {
    next: (value: GraphQLResponse) => void;
    error: (error: Error) => void;
    complete: () => void;
  },
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      // Opt into incremental delivery so the server may stream `@defer` parts.
      accept: "application/json, multipart/mixed",
    };
    if (ctx.userId) headers["x-user-id"] = ctx.userId;
    if (ctx.teamId) headers["x-team-id"] = ctx.teamId;

    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const parts = await meros<IncrementalChunk>(response);

    if (isAsyncIterable(parts)) {
      // multipart/mixed — a `@defer`/`@stream` response. The server speaks the
      // graphql-js incremental-delivery format; translate each chunk into the
      // flat `{ data, path, label, hasNext }` shape Relay's executor expects.
      for await (const part of parts) {
        if (part.json) {
          forwardChunk(part.body, sink);
        } else {
          sink.error(new Error("Unexpected non-JSON chunk in GraphQL stream"));
          return;
        }
      }
    } else {
      // A single application/json response.
      sink.next((await parts.json()) as GraphQLResponse);
    }

    sink.complete();
  } catch (error) {
    sink.error(error instanceof Error ? error : new Error(String(error)));
  }
}

function isAsyncIterable<T>(
  value: Response | AsyncIterableIterator<T>,
): value is AsyncIterableIterator<T> {
  return (
    value != null &&
    typeof (value as AsyncIterableIterator<T>)[Symbol.asyncIterator] ===
      "function"
  );
}

/**
 * One part of a `multipart/mixed` GraphQL response. The initial part carries the
 * non-deferred `data`; subsequent parts carry an `incremental` array (graphql-js
 * incremental-delivery format) — each entry the data for one `@defer`-ed
 * fragment, identified by `path` + `label`.
 */
type IncrementalChunk = {
  data?: unknown;
  errors?: unknown;
  path?: ReadonlyArray<string | number>;
  label?: string;
  hasNext?: boolean;
  extensions?: Record<string, unknown>;
  incremental?: ReadonlyArray<{
    data?: unknown;
    errors?: unknown;
    path?: ReadonlyArray<string | number>;
    label?: string;
  }>;
};

function forwardChunk(
  chunk: IncrementalChunk,
  sink: { next: (value: GraphQLResponse) => void },
): void {
  if (Array.isArray(chunk.incremental)) {
    // Relay identifies a deferred payload by a non-null `path`/`label`, so each
    // incremental entry becomes its own flat response.
    for (const entry of chunk.incremental) {
      sink.next({
        data: entry.data ?? null,
        errors: entry.errors,
        path: entry.path,
        label: entry.label,
        hasNext: chunk.hasNext ?? false,
      } as unknown as GraphQLResponse);
    }
    return;
  }

  // The initial payload carries `data`; a trailing `{ hasNext: false }`
  // terminator carries neither — drop it (sink.complete ends the stream) so
  // Relay never sees a dataless response.
  if (chunk.data !== undefined || chunk.errors !== undefined) {
    sink.next(chunk as GraphQLResponse);
  }
}

export function createRelayEnvironment(ctx: WorkspaceCtx): Environment {
  return new Environment({
    network: Network.create(createFetch(ctx)),
    store: new Store(new RecordSource()),
    // The store is authoritative for the session; reads of missing data suspend
    // and fetch, which is exactly the transition-friendly behavior we want.
    isServer: false,
  });
}
