/** Marks an API request issued by the co-located Next.js server. */
export const COLOCATED_SERVER_REQUEST_HEADER =
  "x-demo-colocated-server-request";

/**
 * How many tasks `GET /api/tasks` serves when the caller names no `limit`.
 *
 * Small enough that the seeded Acme workspace spans two pages, which is the
 * point: `/lane` reads the first from the route and the rest from the browser.
 */
export const TASK_PAGE_SIZE = 10;

/**
 * The endpoint's ceiling, and how a caller spells "the whole list". Every route
 * in this demo except `/lane` reads the list entire and asks for this; the
 * seeded dataset fits under it by three orders of magnitude, which a real one
 * would not — that is why the endpoint has a page at all.
 */
export const TASK_PAGE_LIMIT_MAX = 500;

/** The same ceiling, as the query string carries it. */
export const ALL_TASKS_LIMIT = String(TASK_PAGE_LIMIT_MAX);
