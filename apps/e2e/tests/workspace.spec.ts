import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { instant } from "@next/playwright";

// Seeded data from apps/demo/src/server/team/db.ts
const ACME_TEAM = "Acme Product Team";
const GROWTH_TEAM = "Growth Pod";
const ACME_TASK = "Review billing webhook retry behavior";
const ACME_TASK_ID = "task_webhook";
const ACME_INVOICE_TASK = "Generate downloadable invoice PDFs";
const GROWTH_TASK = "Welcome email rewrite";

const SEARCH_PLACEHOLDER = "Search tasks, labels…";

/**
 * The three reads `/lane` serves from `"use cache"`. Nothing the browser
 * mutates lives in them, so no rerender this route asks for may re-read one.
 */
const CACHED_READ_PATHS = ["/api/projects", "/api/labels", "/api/members"];

type TeamApiRequestRecord = {
  method: string;
  origin: "browser" | "server";
  path: string;
  sequence: number;
};

async function resetRequestDiagnostics(request: APIRequestContext) {
  const response = await request.delete("/api/_diagnostics/requests");
  expect(response.status()).toBe(204);
}

async function readRequestDiagnostics(
  request: APIRequestContext,
): Promise<TeamApiRequestRecord[]> {
  const response = await request.get("/api/_diagnostics/requests");
  expect(response.ok()).toBe(true);
  return (await response.json() as { requests: TeamApiRequestRecord[] })
    .requests;
}

/** Server-origin reads of one endpoint — the co-located renders, not the tab's. */
function serverReadsOf(
  records: TeamApiRequestRecord[],
  path: string,
): TeamApiRequestRecord[] {
  return records.filter(
    (entry) =>
      entry.origin === "server" &&
      entry.method === "GET" &&
      (entry.path === path || entry.path.startsWith(`${path}?`)),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A task list row: a button whose accessible name is "Status: <s> <title> …". */
function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(escapeRegExp(title)) });
}

/** Every row in the list, in the order the list decided to draw them. */
function taskRows(page: Page) {
  return page.locator("[data-task-id]");
}

async function rowOrder(page: Page): Promise<string[]> {
  return taskRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-task-id") ?? ""),
  );
}

function searchInput(page: Page) {
  return page.getByPlaceholder(SEARCH_PLACEHOLDER);
}

/** The detail panel is the only aside containing textareas (title, description). */
function detailPanel(page: Page) {
  return page.locator("aside").filter({ has: page.locator("textarea") });
}

function detailTitle(page: Page) {
  return detailPanel(page).locator("textarea").first();
}

async function gotoWorkspace(page: Page, path = "/lane") {
  await page.goto(path);
  // SSR paints before hydration; settle so interactions reach live handlers.
  await page.waitForLoadState("networkidle");
}

async function createTask(page: Page, title: string) {
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.getByRole("button", { name: "Create task" }).click();
  // The created task opens in the detail panel.
  await expect(detailTitle(page)).toHaveValue(title);
}

/** Change the status from a status control, choosing a value it does not hold. */
async function chooseAnotherStatus(
  page: Page,
  control: ReturnType<Page["getByRole"]>,
): Promise<string> {
  const label = (await control.getAttribute("aria-label")) ?? "";
  const current = label.replace(/^Status:\s*/, "").trim();
  const next =
    ["In progress", "In review", "Todo", "Backlog"].find(
      (status) => status !== current,
    ) ?? "Todo";

  await control.click();
  await page.getByRole("button", { name: next, exact: true }).click();

  return next;
}

test("a cold server-owned publication skips browser transport latency", async ({
  page,
}) => {
  const startedAt = Date.now();
  await gotoWorkspace(page);

  expect(Date.now() - startedAt).toBeLessThan(3_000);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("the server-owned route paints its frame before any region resolves", async ({
  page,
}) => {
  await page.goto("/");

  await instant(page, async () => {
    await page.locator('a[href="/lane"]').click();
    // There is no hand-written whole-screen shell. The frame reads nothing, so
    // it is static, and what fills the regions is each region's own fallback.
    await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
    await expect(page.getByTestId("task-list-skeleton")).toBeVisible();
    await expect(page.getByTestId("sidebar-skeleton")).toBeVisible();
  });

  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(page.getByTestId("task-list-skeleton")).toBeHidden();
});

test("every region resolves the session through one source read", async ({
  page,
  request,
}) => {
  // Five regions resolve the session independently — that is what keeps the
  // frame free of awaits. `getSession` is `React.cache`d so it still costs one
  // read; without it this is five.
  await resetRequestDiagnostics(request);
  await gotoWorkspace(page, "/lane");

  const sessionReads = (await readRequestDiagnostics(request)).filter(
    (entry) => entry.origin === "server" && entry.path === "/api/me",
  );
  expect(sessionReads).toHaveLength(1);
});

test("regions stream independently rather than landing together", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('a[href="/lane"]').click();

  // The task list is a fast read; the sidebar waits on the project counts. The
  // list must not be held back to the sidebar's latency.
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(page.getByTestId("task-list-skeleton")).toBeHidden();
});

test("loads the seeded workspace", async ({ page }) => {
  await gotoWorkspace(page);

  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(page.getByText(ACME_TEAM)).toBeVisible();
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
});

test("reload preserves search, selection, and team", async ({ page }) => {
  await gotoWorkspace(page);

  await searchInput(page).fill("billing");
  await expect(page).toHaveURL(/q=billing/);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await taskRow(page, ACME_TASK).click();
  await expect(page).toHaveURL(new RegExp(`task=${ACME_TASK_ID}`));
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);

  await page.reload();

  await expect(searchInput(page)).toHaveValue("billing");
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("search filters the task list", async ({ page }) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await searchInput(page).fill("invoice");

  await expect(taskRow(page, ACME_INVOICE_TASK)).toBeVisible();
  await expect(taskRow(page, ACME_TASK)).toBeHidden();

  await searchInput(page).fill("");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("a load reads the dynamic sources and takes the rest from the cache", async ({
  page,
  request,
}) => {
  // Each read runs once per render pass however many regions ask for it — the
  // task list and the filter bar share one `/api/tasks`, the sidebar and the
  // strip one `/api/insights`. The three reference reads run no times at all:
  // some earlier render filled them and nothing has expired their tags.
  await resetRequestDiagnostics(request);
  await gotoWorkspace(page, "/lane");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(1);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(1);
  for (const path of CACHED_READ_PATHS) {
    expect(serverReadsOf(records, path), `${path} on a warm load`).toHaveLength(
      0,
    );
  }
});

test("a rerender re-reads what the browser can change and nothing else", async ({
  page,
  request,
}) => {
  // A filter is a navigation, which renders the whole route — the same work a
  // mutation's rerender does. What it may not do is read the three sources
  // behind `"use cache"`: nothing that changes them has happened.
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await resetRequestDiagnostics(request);
  await page.getByRole("link", { name: /In review/ }).first().click();
  await expect(page).toHaveURL(/status=in_review/);
  await expect(page.getByTestId("task-list-skeleton")).toBeHidden();

  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, "/api/tasks").length).toBeGreaterThan(0);
  for (const path of CACHED_READ_PATHS) {
    expect(serverReadsOf(records, path), `${path} on a rerender`).toHaveLength(
      0,
    );
  }
});

test("an inline status change lands in the row where it already was", async ({
  page,
  request,
}) => {
  // Opened the way a user opens it: a click on the row, which is an in-app
  // navigation and therefore a republication. The reader has to survive that to
  // converge at all.
  await gotoWorkspace(page);
  await taskRow(page, ACME_TASK).click();
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);

  const before = await rowOrder(page);
  const index = before.indexOf(ACME_TASK_ID);
  expect(index).toBeGreaterThanOrEqual(0);

  await resetRequestDiagnostics(request);
  const next = await chooseAnotherStatus(
    page,
    detailPanel(page).getByRole("button", { name: /^Status:/ }),
  );

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(
    detailPanel(page).getByRole("button", { name: `Status: ${next}` }),
  ).toBeVisible();
  // The row took the new value in place: same list, same index, no re-sort.
  await expect(
    taskRow(page, ACME_TASK).getByRole("button", { name: `Status: ${next}` }),
  ).toBeVisible();
  expect(await rowOrder(page)).toEqual(before);

  const records = await readRequestDiagnostics(request);
  // One write, from the tab, through the Route Handler.
  expect(
    records.filter(
      (entry) => entry.origin === "browser" && entry.method === "PATCH",
    ),
  ).toHaveLength(1);
  // Whatever the rerender that follows reads, it is never one of these.
  for (const path of CACHED_READ_PATHS) {
    expect(
      serverReadsOf(records, path),
      `${path} after a task edit`,
    ).toHaveLength(0);
  }
});

/**
 * The half of the convergence a reader has to outlive a republication for.
 *
 * Both of these reach the panel through an in-app navigation — a create, which
 * is a Server Action whose response republishes every key on the route. A
 * reader that lost its subscription to that publication would keep the old row
 * and never ask for the counters, which is exactly what these two watch for.
 */
test("an edit after an in-app navigation reaches the list", async ({ page }) => {
  await gotoWorkspace(page);

  const stamp = Date.now();
  const original = `E2E rename source ${stamp}`;
  const renamed = `E2E renamed destination ${stamp}`;
  await createTask(page, original);

  await detailTitle(page).fill(renamed);
  await detailTitle(page).press("Enter");

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(detailTitle(page)).toHaveValue(renamed);
  await expect(taskRow(page, renamed)).toBeVisible();
  await expect(taskRow(page, original)).toBeHidden();
});

test("a task edit asks the owner for the counters exactly once", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);
  const title = `E2E counter task ${Date.now()}`;
  await createTask(page, title);

  const inProgressCard = page.getByRole("link", { name: /In progress/ });
  const before = Number((await inProgressCard.innerText()).match(/\d+/)?.[0]);

  await resetRequestDiagnostics(request);
  await chooseAnotherStatus(
    page,
    detailPanel(page).getByRole("button", { name: /^Status:/ }),
  );
  await expect(page.getByText("Saved")).toBeVisible();

  await expect(async () => {
    const text = await inProgressCard.innerText();
    expect(Number(text.match(/\d+/)?.[0])).toBe(before + 1);
  }).toPass();

  // One ask, one rerender: the insights are read once and the three cached
  // sources are not read at all.
  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(1);
  for (const path of CACHED_READ_PATHS) {
    expect(serverReadsOf(records, path)).toHaveLength(0);
  }
});

test("deleting a task drops its row and clears the detail", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);

  const title = `E2E delete target ${Date.now()}`;
  await createTask(page, title);
  await expect(taskRow(page, title)).toBeVisible();

  await resetRequestDiagnostics(request);
  await taskRow(page, title)
    .getByRole("button", { name: "Task actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();

  // The row leaves every list holding it as soon as the API confirms — no
  // republication in between.
  await expect(taskRow(page, title)).toBeHidden();
  await expect(page).not.toHaveURL(/task=/);
  await expect(detailPanel(page)).toHaveCount(0);

  const records = await readRequestDiagnostics(request);
  expect(
    records.filter(
      (entry) => entry.origin === "browser" && entry.method === "DELETE",
    ),
  ).toHaveLength(1);
  for (const path of CACHED_READ_PATHS) {
    expect(serverReadsOf(records, path), `${path} after a delete`).toHaveLength(
      0,
    );
  }
});

test("creating a task reads the list again and opens the new task", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  const title = `E2E created task ${Date.now()}`;
  await resetRequestDiagnostics(request);
  await createTask(page, title);

  // Channel 1: the action's response is the route, so the row arrives where the
  // server sorted it rather than where the client guessed.
  await expect(taskRow(page, title)).toBeVisible();

  const records = await readRequestDiagnostics(request);
  expect(
    records.filter(
      (entry) => entry.origin === "server" && entry.method === "POST",
    ),
  ).toHaveLength(1);
  expect(serverReadsOf(records, "/api/tasks").length).toBeGreaterThan(0);
  expect(serverReadsOf(records, "/api/insights").length).toBeGreaterThan(0);
  // The task was created without a project, so no project count moved and the
  // cached reads stay cached.
  for (const path of CACHED_READ_PATHS) {
    expect(serverReadsOf(records, path), `${path} after a create`).toHaveLength(
      0,
    );
  }
});

test("creating a label expires the cached read that lists them", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page, `/lane?task=${ACME_TASK_ID}`);
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);

  const name = `e2elabel${Date.now()}`;
  await resetRequestDiagnostics(request);
  await detailPanel(page).getByRole("button", { name: "Add label" }).click();
  await page.getByPlaceholder("Search or create label…").fill(name);
  await page.getByRole("button", { name: /^Create/ }).click();

  // The label is on the task, and — the point of the test — in the sidebar,
  // which lists what the *published* labels read returned.
  await expect(
    detailPanel(page).getByRole("button", { name: `Remove ${name}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(escapeRegExp(name)) }),
  ).toBeVisible();

  const records = await readRequestDiagnostics(request);
  // `updateTag` expired the labels entry and re-rendered the route in the same
  // response, so the labels are read again — exactly once — while the other two
  // cached reads are untouched.
  expect(serverReadsOf(records, "/api/labels")).toHaveLength(1);
  expect(serverReadsOf(records, "/api/projects")).toHaveLength(0);
  expect(serverReadsOf(records, "/api/members")).toHaveLength(0);
});

test("a title-only update lands in the panel and the row", async ({ page }) => {
  await gotoWorkspace(page, `/lane?task=${ACME_TASK_ID}`);
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);

  const renamed = `${ACME_TASK} v${Date.now() % 10_000}`;
  await detailTitle(page).fill(renamed);
  await detailTitle(page).press("Enter");

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(detailTitle(page)).toHaveValue(renamed);
  await expect(taskRow(page, renamed)).toBeVisible();

  // Put the seeded title back: the tests after this one match on it.
  await detailTitle(page).fill(ACME_TASK);
  await detailTitle(page).press("Enter");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("team switching swaps workspace data without leaking", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await page.getByRole("button", { name: new RegExp(ACME_TEAM) }).click();
  await page.getByText(GROWTH_TEAM).click();

  await expect(page).toHaveURL(/team=t_growth/);
  await expect(taskRow(page, GROWTH_TASK)).toBeVisible();
  await expect(taskRow(page, ACME_TASK)).toBeHidden();
});

test("a failed refresh keeps data visible and recovers through the chip", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  // Break the refresh where it actually travels: the manual refresh is still a
  // server action (a POST to the page), not a browser-side /api fetch. The
  // store keeps its published values, so the rows must stay rendered while the
  // chip reports the failure.
  await page.route("**/lane**", (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.fallback(),
  );

  await expect(async () => {
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(page.getByText("Couldn't refresh")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });

  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await page.unroute("**/lane**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();

  await expect(page.getByText("Couldn't refresh")).toBeHidden();
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});
