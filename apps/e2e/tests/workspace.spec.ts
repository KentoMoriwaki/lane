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
const BILLING_PROJECT = "Billing";

/**
 * The page `/api/tasks` serves when nobody names a `limit`
 * (`apps/demo/src/lib/team-api.ts`). The seeded Acme workspace has sixteen
 * tasks, so its list is two pages: the route publishes the first and the
 * browser fetches the second.
 */
const PAGE_SIZE = 10;

/**
 * The last row of page 1 and the first row of page 2, under the list's sort
 * (closed last, then priority, status, age, id). Tasks created by the tests in
 * this file default to the lowest priority, so they land behind every seeded
 * open task and never move this boundary.
 */
const ACME_PAGE_ONE_LAST_ID = "task_audit_log";
const ACME_PAGE_TWO_TASK = "Design calmer empty states";
const ACME_PAGE_TWO_TASK_ID = "task_empty_states";

const SEARCH_PLACEHOLDER = "Search tasks, labels…";

/**
 * The three reads `/lane` serves from `"use cache"`. Nothing the browser
 * mutates lives in them, so no rerender this route asks for may re-read one.
 */
const CACHED_READ_PATHS = ["/api/projects", "/api/labels", "/api/members"];

/**
 * The counts that used to ride inside the cached roster. They are their own
 * dynamic read now, so a task edit moves them without expiring anything.
 */
const PROJECT_COUNTS_PATH = "/api/projects/counts";

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

/** The tab's own reads of one endpoint — the other half of the same list. */
function browserReadsOf(
  records: TeamApiRequestRecord[],
  path: string,
): TeamApiRequestRecord[] {
  return records.filter(
    (entry) =>
      entry.origin === "browser" &&
      entry.method === "GET" &&
      (entry.path === path || entry.path.startsWith(`${path}?`)),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A task list row: a `<Link>` to the task's own route, named by its title
 * alone. It used to be a button that toggled a `?task=` parameter.
 */
function taskRow(page: Page, title: string) {
  return page.getByRole("link", { name: title, exact: true });
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

/**
 * The two shells `/lane/task/<id>` renders as, each naming itself in the DOM.
 *
 * A `<Link>` from a row is intercepted into the panel beside the list; a direct
 * visit, a reload, or a shared link renders the full page. One URL, one read,
 * two surfaces — and which one is on screen is what decides how an edit made
 * there converges.
 */
function detailPanel(page: Page) {
  return page.getByTestId("task-panel");
}

function detailPage(page: Page) {
  return page.getByTestId("task-page");
}

function detailTitle(page: Page) {
  return detailPanel(page).locator("textarea").first();
}

function pageTitle(page: Page) {
  return detailPage(page).locator("textarea").first();
}

/** The URL both surfaces share. */
function taskUrl(taskId: string) {
  return `/lane/task/${taskId}`;
}

/** Open a task the way the demo intends it to be opened: click its row. */
async function openTaskPanel(page: Page, title: string) {
  await taskRow(page, title).click();
  await expect(detailTitle(page)).toHaveValue(title);
}

/**
 * The control the list offers while `hasNext` — the browser's half of a list
 * whose first page came from the route.
 */
function loadMoreButton(page: Page) {
  return page.getByTestId("load-more");
}

/**
 * Take the list one page deeper, the way a user does, and wait for the rows.
 *
 * Every test that wants a task the first page does not hold has to do this
 * first: a task created here sorts behind every seeded open task, and the
 * seeded list is longer than one page.
 */
async function loadMore(page: Page) {
  const before = await taskRows(page).count();
  await loadMoreButton(page).click();
  await expect(taskRows(page)).not.toHaveCount(before);
}

/**
 * Deepen the list until a row is on screen. A task these tests create sorts
 * behind every seeded open task — and behind every task an earlier test in the
 * run created — so which page it lands on depends on what ran before; the
 * list is deepened page by page until it shows, or there is no more to load.
 */
async function loadUntilVisible(page: Page, title: string) {
  for (let depth = 0; depth < 6; depth += 1) {
    if (await taskRow(page, title).isVisible()) {
      return;
    }
    if ((await loadMoreButton(page).count()) === 0) {
      break;
    }
    await loadMore(page);
  }
  await expect(taskRow(page, title)).toBeVisible();
}

/** The sidebar's count for one project, read out of its nav link. */
async function projectCount(page: Page, name: string): Promise<number> {
  const text = await page
    .getByRole("link", { name: new RegExp(`^${escapeRegExp(name)}`) })
    .innerText();
  return Number(text.match(/\d+/)?.[0]);
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

test("opening a task is a navigation to its own URL", async ({ page }) => {
  await gotoWorkspace(page);

  await searchInput(page).fill("billing");
  await expect(page).toHaveURL(/q=billing/);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await taskRow(page, ACME_TASK).click();

  // The selection is a path, not a parameter — and the view travels with it, so
  // the list behind the panel still reads the key it was published under.
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(taskUrl(ACME_TASK_ID))}\\?.*q=billing`),
  );
  // Clicked from a row, it is intercepted: the panel, with the list still there.
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(detailPage(page)).toHaveCount(0);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("a reload of a task URL renders the page, not the panel", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await searchInput(page).fill("billing");
  await expect(page).toHaveURL(/q=billing/);
  await openTaskPanel(page, ACME_TASK);

  await page.reload();

  // Nothing intercepts a fresh document load, so `children` is the task page
  // and the `@modal` slot renders nothing.
  await expect(pageTitle(page)).toHaveValue(ACME_TASK);
  await expect(detailPanel(page)).toHaveCount(0);
  await expect(page).toHaveURL(/q=billing/);

  // The way back carries the view it left with.
  await page.getByRole("link", { name: "Back to tasks" }).click();
  await expect(searchInput(page)).toHaveValue("billing");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("Back closes the panel and leaves the list standing", async ({ page }) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await openTaskPanel(page, ACME_TASK);

  await page.goBack();

  await expect(page).toHaveURL(/\/lane(\?|$)/);
  // Hidden, not gone: the router keeps the intercepted tree alive in a hidden
  // `<Activity>` so reopening it is instant (measured in activity-lab #96).
  await expect(detailPanel(page)).toBeHidden();
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
  await openTaskPanel(page, ACME_TASK);

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
  // And exactly one rerender behind it: the two marked keys — the insights and
  // the project counts — were marked in the same tick, so Lane asked once.
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(1);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(1);
  expect(serverReadsOf(records, PROJECT_COUNTS_PATH)).toHaveLength(1);
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
  // A new task sorts behind every seeded open task, which puts it on the second
  // page. The browser has to have asked for that page before the list can show
  // the rename landing in it.
  await loadUntilVisible(page, original);

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
  // On the second page, like every task these tests create.
  await loadUntilVisible(page, title);

  await resetRequestDiagnostics(request);
  await taskRow(page, title)
    .getByRole("button", { name: "Task actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();

  // The row leaves every list holding it as soon as the API confirms — no
  // republication in between.
  await expect(taskRow(page, title)).toBeHidden();
  await expect(page).not.toHaveURL(/\/lane\/task\//);
  // The intercepted tree stays mounted but hidden after the view moves back to
  // the list (router keep-alive); what matters is that nothing shows it.
  await expect(detailPanel(page)).toBeHidden();

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
  // server sorted it rather than where the client guessed — which for a new task
  // is the second page, and the browser asks for that itself.
  await loadUntilVisible(page, title);

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
  // Through the row, because the sidebar has to be on screen for the assertion
  // below — a direct visit to the task URL renders the page, which has no
  // workspace frame around it.
  await gotoWorkspace(page);
  await openTaskPanel(page, ACME_TASK);

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
  await gotoWorkspace(page);
  await openTaskPanel(page, ACME_TASK);

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

/**
 * The other surface, and the whole reason a task is a route of its own.
 *
 * An edit made where no list is on screen marks every list entry the lane holds
 * instead of rewriting one. Nothing is read for it while the page is up — a
 * marked key with no reader stays marked — and the read happens when a list is
 * revealed again.
 */
test("an edit on the task page is read again only when the list is", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);
  await openTaskPanel(page, ACME_TASK);

  // A reload of the same URL is not intercepted, so the detail is now the full
  // page: same task, same key, no list beside it.
  await page.reload();
  await expect(pageTitle(page)).toHaveValue(ACME_TASK);
  await expect(detailPanel(page)).toHaveCount(0);

  await resetRequestDiagnostics(request);
  const next = await chooseAnotherStatus(
    page,
    detailPage(page).getByRole("button", { name: /^Status:/ }),
  );
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(
    detailPage(page).getByRole("button", { name: `Status: ${next}` }),
  ).toBeVisible();

  // One write and nothing else. The marks this edit left have no reader on this
  // page — no list, no strip, no sidebar — so no rerender was asked for.
  const afterEdit = await readRequestDiagnostics(request);
  expect(
    afterEdit.filter(
      (entry) => entry.origin === "browser" && entry.method === "PATCH",
    ),
  ).toHaveLength(1);
  expect(serverReadsOf(afterEdit, "/api/tasks")).toHaveLength(0);
  expect(serverReadsOf(afterEdit, "/api/insights")).toHaveLength(0);

  await resetRequestDiagnostics(request);
  await page.goBack();

  // Back on the list: it arrives freshly sorted, with the edit in it, and the
  // insights are the ones that go with it.
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(
    taskRow(page, ACME_TASK).getByRole("button", { name: `Status: ${next}` }),
  ).toBeVisible();

  // Exactly one render answered the traverse.
  const afterBack = await readRequestDiagnostics(request);
  expect(serverReadsOf(afterBack, "/api/tasks")).toHaveLength(1);
  expect(serverReadsOf(afterBack, "/api/insights")).toHaveLength(1);
  for (const path of CACHED_READ_PATHS) {
    expect(serverReadsOf(afterBack, path), `${path} after a back`).toHaveLength(
      0,
    );
  }
});

/**
 * The count that used to ride inside the cached roster.
 *
 * A project's task count is changed by the browser channel — a move, a delete —
 * which cannot expire a tag. It is its own dynamic read now, so the number
 * follows the edit while the roster it sits beside stays cached.
 */
test("a project's count follows a task the browser moved", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);

  const title = `E2E count mover ${Date.now()}`;
  await createTask(page, title);
  // Deep enough to hold the new row, so the delete at the end has a row to take
  // away — and takes it out of the page that holds it, not the first one.
  await loadUntilVisible(page, title);
  const before = await projectCount(page, BILLING_PROJECT);

  await resetRequestDiagnostics(request);
  await detailPanel(page).getByRole("button", { name: "No project" }).click();
  await page.getByRole("option", { name: new RegExp(`^${BILLING_PROJECT}`) })
    .click();
  await expect(page.getByText("Saved")).toBeVisible();

  await expect(async () => {
    expect(await projectCount(page, BILLING_PROJECT)).toBe(before + 1);
  }).toPass();

  // The number moved through the dynamic read, and the roster beside it was not
  // read at all: no tag was expired, because none needed to be.
  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, PROJECT_COUNTS_PATH)).toHaveLength(1);
  expect(serverReadsOf(records, "/api/projects")).toHaveLength(0);

  // And back down when the task goes away.
  await resetRequestDiagnostics(request);
  await detailPanel(page).getByRole("button", { name: "Delete task" }).click();
  await expect(taskRow(page, title)).toBeHidden();

  await expect(async () => {
    expect(await projectCount(page, BILLING_PROJECT)).toBe(before);
  }).toPass();

  // A delete from the panel also moves the view back to the list, and that
  // navigation can abort the `router.refresh()` the marks asked for while it
  // is in flight. The server may already have rendered for it; the lane asks
  // again for the readers still waiting (`REASK_INTERVAL`), and that one lands.
  // So: one or two renders, and the roster is read by neither.
  const afterDelete = await readRequestDiagnostics(request);
  const countReads = serverReadsOf(afterDelete, PROJECT_COUNTS_PATH).length;
  expect(countReads).toBeGreaterThanOrEqual(1);
  expect(countReads).toBeLessThanOrEqual(2);
  expect(serverReadsOf(afterDelete, "/api/projects")).toHaveLength(0);
});

test("opening a task paints the panel's shell before the read lands", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  // The intercepted route makes the same claim the list does: its shell is
  // static, so the navigation produces UI without waiting for the server.
  await instant(page, async () => {
    await taskRow(page, ACME_TASK).click();
    await expect(page.getByTestId("task-panel-skeleton")).toBeVisible();
  });

  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
});

/**
 * **The list's first page belongs to the route; its depth belongs to the
 * browser** — and both live under one key.
 *
 * The three tests below are the whole claim: where each page comes from, what a
 * republication does to a depth the browser paid for, and what an explicit
 * "this list is stale" does to it instead.
 */
test("the list's second page comes from the browser", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  // The route published one page, and the list says so rather than implying it
  // has everything.
  expect(await taskRows(page).count()).toBe(PAGE_SIZE);
  await expect(taskRow(page, ACME_PAGE_TWO_TASK)).toHaveCount(0);
  await expect(page.getByTestId("task-count")).toHaveText(/10 tasks so far/);
  await expect(loadMoreButton(page)).toBeVisible();

  const firstPage = await rowOrder(page);
  await resetRequestDiagnostics(request);
  await loadMore(page);

  await expect(taskRow(page, ACME_PAGE_TWO_TASK)).toBeVisible();
  const both = await rowOrder(page);
  // Page 1 kept every row it had, in the order it had them…
  expect(both.filter((id) => firstPage.includes(id))).toEqual(firstPage);
  // …and page 2 arrived behind the last row of page 1.
  expect(both.indexOf(ACME_PAGE_TWO_TASK_ID)).toBeGreaterThan(
    both.indexOf(ACME_PAGE_ONE_LAST_ID),
  );
  expect(both.length).toBeGreaterThan(firstPage.length);

  const records = await readRequestDiagnostics(request);
  // One request, from the tab, carrying the cursor page 1 handed back.
  const fetched = browserReadsOf(records, "/api/tasks");
  expect(fetched).toHaveLength(1);
  expect(fetched[0]?.path).toContain("cursor=");
  // And nothing was asked of the route: a deeper list is not a rerender.
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(0);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(0);
});

test("an inline edit keeps the pages the browser loaded", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);
  await loadMore(page);
  await expect(taskRow(page, ACME_PAGE_TWO_TASK)).toBeVisible();

  // Opened from a row, which is a navigation and therefore a republication of
  // page 1 — the first of two this test puts the depth through.
  await openTaskPanel(page, ACME_PAGE_TWO_TASK);
  const before = await rowOrder(page);
  expect(before.length).toBeGreaterThan(PAGE_SIZE);

  await resetRequestDiagnostics(request);
  const next = await chooseAnotherStatus(
    page,
    detailPanel(page).getByRole("button", { name: /^Status:/ }),
  );
  await expect(page.getByText("Saved")).toBeVisible();

  // The row took the new value inside the page that holds it, at the index it
  // already occupied — a second page is patched exactly like a first.
  await expect(
    taskRow(page, ACME_PAGE_TWO_TASK).getByRole("button", {
      name: `Status: ${next}`,
    }),
  ).toBeVisible();
  expect(await rowOrder(page)).toEqual(before);

  const records = await readRequestDiagnostics(request);
  expect(
    records.filter(
      (entry) => entry.origin === "browser" && entry.method === "PATCH",
    ),
  ).toHaveLength(1);
  // One rerender, for the two counters the edit marked. The page 1 it
  // republishes is the page 1 already standing there, so the pages behind it
  // stay — and the browser does not re-fetch a single one of them.
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(1);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(1);
  expect(browserReadsOf(records, "/api/tasks")).toHaveLength(0);
});

test("an edit on the task page resets the list to one page when it is looked at again", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await loadMore(page);
  expect(await taskRows(page).count()).toBeGreaterThan(PAGE_SIZE);

  // The other surface: a direct visit is not intercepted, so this is the full
  // task page with no list beside it, and an edit here marks every list entry
  // stale rather than patching a row.
  await page.goto(taskUrl(ACME_TASK_ID));
  await expect(pageTitle(page)).toHaveValue(ACME_TASK);
  await expect(detailPanel(page)).toHaveCount(0);

  const next = await chooseAnotherStatus(
    page,
    detailPage(page).getByRole("button", { name: /^Status:/ }),
  );
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goBack();

  // One page, freshly sorted, with the edit in it — and the button back, because
  // there is more again. An explicit invalidate resets the depth by design:
  // "this list is stale" is said about pages 2..n as well, and they cannot be
  // re-derived without walking the cursor chain from the start.
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(
    taskRow(page, ACME_TASK).getByRole("button", { name: `Status: ${next}` }),
  ).toBeVisible();
  expect(await taskRows(page).count()).toBe(PAGE_SIZE);
  await expect(loadMoreButton(page)).toBeVisible();

  // And the browser can buy the depth back.
  await loadMore(page);
  await expect(taskRow(page, ACME_PAGE_TWO_TASK)).toBeVisible();
});
