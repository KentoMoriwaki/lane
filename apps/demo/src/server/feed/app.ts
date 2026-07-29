import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  InvalidCursorError,
  deleteItem,
  feedRevision,
  feedTotal,
  headItem,
  nextSequence,
  prependItem,
  readPage,
  resetFeed,
  updateItemTitle,
} from "./data";
import {
  createFeedItemInputSchema,
  feedMutationQuerySchema,
  feedPageQuerySchema,
  updateFeedItemInputSchema,
  type FeedItem,
  type FeedMutationResponse,
  type FeedPageResponse,
} from "./schema";

/**
 * The infinite-scroll lab's API, mounted at `/api/feed`.
 *
 * It is a *separate* Hono app from the team API on purpose. `server/team/app.ts`
 * wraps every one of its routes in artificial read/write latency and an
 * optional random-failure middleware; the lab needs to own its timing exactly
 * (latency is a per-request knob here), so inheriting that middleware would
 * corrupt every measurement the lab exists to take. Instead this app gets its
 * own Route Handler segment at `app/api/feed/[...route]/route.ts`, the same way
 * `/api/graphql` sits beside the team catch-all. Nothing in `server/team/*` is
 * touched.
 *
 * Every response — success or failure — carries `seq` (a process-wide counter
 * stamped at serve time) plus the cursor the request was made with, so the
 * client can reconstruct the true server-side ordering of overlapping requests
 * rather than inferring it from when responses happened to arrive.
 */

const validationHook = (
  result: { success: boolean; error?: { message: string } },
  context: { json: (body: unknown, status: 400) => Response },
) => {
  if (!result.success) {
    return context.json(
      { error: result.error?.message ?? "Invalid request", code: "invalid_request" },
      400,
    );
  }
};

function delay(milliseconds: number): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function meta(latencyMs: number, requestedCursor: string | null = null) {
  return {
    seq: nextSequence(),
    servedAt: new Date().toISOString(),
    requestedCursor,
    latencyMs,
    revision: feedRevision(),
    total: feedTotal(),
  };
}

function mutationResponse(
  item: FeedItem | null,
  latencyMs: number,
): FeedMutationResponse {
  return { ...meta(latencyMs), item };
}

const feed = new Hono();

// The lab is measuring the network, so nothing on this endpoint may be cached
// by the browser, a proxy, or Next's fetch cache.
feed.use("*", async (context, next) => {
  await next();
  context.header("cache-control", "no-store, max-age=0");
});

feed
  .get(
    "/items",
    zValidator("query", feedPageQuerySchema, validationHook),
    async (context) => {
      const query = context.req.valid("query");
      const requestedCursor = query.cursor ?? null;

      // Latency is applied before anything else, so an injected failure is as
      // slow as a success and the timeline stays honest.
      await delay(query.latency);

      let page;
      try {
        page = readPage({
          cursor: requestedCursor,
          limit: query.limit,
          sort: query.sort,
          cursorMode: query.cursorMode,
        });
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          return context.json(
            { error: error.message, code: error.code, seq: nextSequence() },
            400,
          );
        }
        throw error;
      }

      if (query.failAt !== undefined && page.pageIndex === query.failAt) {
        return context.json(
          {
            error: `Injected failure: page ${page.pageIndex} was configured to fail`,
            code: "injected_failure",
            pageIndex: page.pageIndex,
            seq: nextSequence(),
          },
          500,
        );
      }

      const body: FeedPageResponse = {
        items: page.items,
        nextCursor: page.nextCursor,
        pageIndex: page.pageIndex,
        cursorResolution: page.cursorResolution,
        sort: query.sort,
        cursorMode: query.cursorMode,
        limit: query.limit,
        ...meta(query.latency, requestedCursor),
        total: page.total,
      };

      return context.json(body, 200);
    },
  )
  .post(
    "/items",
    zValidator("query", feedMutationQuerySchema, validationHook),
    zValidator("json", createFeedItemInputSchema, validationHook),
    async (context) => {
      const { latency } = context.req.valid("query");
      await delay(latency);

      return context.json(
        mutationResponse(prependItem(context.req.valid("json").title), latency),
        201,
      );
    },
  )
  .patch(
    "/items/:id",
    zValidator("query", feedMutationQuerySchema, validationHook),
    zValidator("json", updateFeedItemInputSchema, validationHook),
    async (context) => {
      const { latency } = context.req.valid("query");
      await delay(latency);

      const item = updateItemTitle(
        context.req.param("id"),
        context.req.valid("json").title,
      );

      if (!item) {
        return context.json({ error: "Item not found", code: "not_found" }, 404);
      }

      return context.json(mutationResponse(item, latency), 200);
    },
  )
  .delete(
    "/items/:id",
    zValidator("query", feedMutationQuerySchema, validationHook),
    async (context) => {
      const { latency } = context.req.valid("query");
      await delay(latency);

      const item = deleteItem(context.req.param("id"));

      if (!item) {
        return context.json({ error: "Item not found", code: "not_found" }, 404);
      }

      return context.json(mutationResponse(item, latency), 200);
    },
  )
  .post(
    "/reset",
    zValidator("query", feedMutationQuerySchema, validationHook),
    async (context) => {
      const { latency } = context.req.valid("query");
      await delay(latency);
      resetFeed();

      return context.json(mutationResponse(headItem("newest"), latency), 200);
    },
  );

const app = new Hono();

export const feedRoutes = app.route("/api/feed", feed);

export type FeedAppType = typeof feedRoutes;
