import type { AppType } from "@/server/api";
import { hc } from "hono/client";
import { COLOCATED_SERVER_REQUEST_HEADER } from "@/lib/team-api";

/**
 * The single place the frontend touches the backend. Everything goes through
 * the typed Hono RPC client; the route's reads and the browser's mutations both
 * call the wrappers in `endpoints.ts`, never `fetch` directly.
 *
 * Both graphs use this module, which is the point rather than an accident: the
 * route reads the API from the server, and the task mutations call the same
 * endpoints from the browser (`api/hooks.ts`). One typed client, one set of
 * wrappers, and the only difference between a caller in Node and a caller in a
 * tab is the two headers `requestOptions` adds below.
 */
/**
 * The team API is embedded in this app (`app/api/[[...route]]/route.ts`), so the
 * browser talks to it same-origin via a relative URL. Server Components (the
 * regions in `regions.tsx`) run in Node and need an absolute origin: an explicit
 * `NEXT_PUBLIC_SITE_URL`, the Vercel deployment URL, or the local dev port.
 */
function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "";
  }

  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return `http://localhost:${process.env.PORT ?? "3006"}`;
}

export const client = hc<AppType>(resolveApiBaseUrl());

/**
 * The active session + team context. It is sent to the API as request headers
 * so the team does not need to be encoded into every query key (see the team
 * scope constraint in the implementation doc).
 *
 * Declared in `@/lib/lane-meta` and re-exported here, because it is also this
 * app's `LaneRegister["loaderMeta"]` — the value the lane hands its loaders — and
 * that declaration belongs to the app rather than to one workspace.
 */
export type { WorkspaceCtx } from "@/lib/lane-meta";
import type { WorkspaceCtx } from "@/lib/lane-meta";

export function requestOptions(ctx: WorkspaceCtx) {
  const headers: Record<string, string> = {};
  // Empty ids are omitted so the API can apply its mock default user on the
  // very first server request, before the current user is known.
  if (ctx.userId) headers["x-user-id"] = ctx.userId;
  if (ctx.teamId) headers["x-team-id"] = ctx.teamId;
  if (typeof window === "undefined") {
    headers["x-random-fail-bypass"] = "1";
    // Source work remains the same for every caller. This marker only removes
    // the browser-to-server portion of the artificial latency model — and it is
    // what tells the request log which side a request came from, which is how
    // the E2E budgets count a background rerender's reads without counting the
    // browser's mutation.
    headers[COLOCATED_SERVER_REQUEST_HEADER] = "1";
  }

  return {
    headers,
    init: {
      cache: "no-store",
    },
  } as const;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  get isForbidden() {
    return this.status === 403 || this.code === "forbidden";
  }

  get isAuthError() {
    return this.status === 401 || this.code === "unauthenticated";
  }
}

export async function assertOk(response: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}): Promise<void> {
  if (response.ok) {
    return;
  }

  const fallback = `Request failed with ${response.status}`;
  const body = await response.text();

  if (!body) {
    throw new ApiError(fallback, response.status, null);
  }

  let data: { error?: unknown; code?: unknown } | null = null;
  try {
    data = JSON.parse(body) as { error?: unknown; code?: unknown };
  } catch {
    // Non-JSON error body; fall through to the raw text.
  }

  const message =
    typeof data?.error === "string" ? data.error : body || fallback;
  const code = typeof data?.code === "string" ? data.code : null;

  throw new ApiError(message, response.status, code);
}
