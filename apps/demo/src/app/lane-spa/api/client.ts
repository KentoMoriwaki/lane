import type { AppType } from "@/server/api";
import { hc } from "hono/client";

/**
 * The single place the frontend touches the backend. Everything goes through
 * the typed Hono RPC client; Lane hooks call the wrappers in `endpoints.ts`,
 * never `fetch` directly.
 */
/**
 * The team API is embedded in this app (`app/api/[[...route]]/route.ts`). This
 * variant is client-only, so in practice the base URL is always the relative,
 * same-origin one; the server branch is kept for parity with the other
 * variants and any incidental server render.
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
 */
export type WorkspaceCtx = {
  userId: string;
  teamId: string;
};

export function requestOptions(ctx: WorkspaceCtx) {
  const headers: Record<string, string> = {};
  // Empty ids are omitted so the API can apply its mock default user on the
  // very first server request, before the current user is known.
  if (ctx.userId) headers["x-user-id"] = ctx.userId;
  if (ctx.teamId) headers["x-team-id"] = ctx.teamId;

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
