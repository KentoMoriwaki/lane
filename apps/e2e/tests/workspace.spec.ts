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
const ACME_INVOICE_TASK_ID = "task_invoice_pdf";
const GROWTH_TASK = "Welcome email rewrite";
const BILLING_PROJECT = "Billing";
const LANE_ALL = "/lane/contexts/all";

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
 * The reference reads `/lane` resolves dynamically with the rest of each route
 * generation. They distinguish a real rerender from a mutation that converged
 * entirely from its own response.
 */
const DYNAMIC_REFERENCE_READ_PATHS = [
  "/api/projects",
  "/api/labels",
  "/api/members",
];

/**
 * The task-derived counts that are separate from the project roster. A task
 * edit can publish them from its response without replacing the roster.
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
 * A task list row: the container, found by the link it carries. The link is
 * laid behind the row rather than wrapped around it — controls are siblings of
 * it, not children — so the row is what holds both, and
 * `taskRow(...).getByRole("button", …)` still reaches a control.
 */
function taskRow(page: Page, title: string) {
  return page
    .locator("[data-task-id]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

/** The way into the task from its row. */
function taskLink(page: Page, title: string) {
  return taskRow(page, title).getByRole("link", { name: title, exact: true });
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
  // Next keeps the previous route tree in a hidden Activity after a client
  // navigation. Target the live workspace rather than its cached search box.
  return page.locator(
    `input[placeholder="${SEARCH_PLACEHOLDER}"]:visible`,
  );
}

/** The task panel, whether intercepted or reconstructed by a hard load. */
function detailPanel(page: Page) {
  // Next keeps previously visited intercepted trees in hidden Activities.
  // Interacting with "the panel" always means the one currently on screen.
  return page.locator('[data-testid="task-panel"]:visible');
}

function detailTitle(page: Page) {
  return detailPanel(page).locator("textarea").first();
}

/** A task has one canonical identity, independent of the list behind it. */
function taskUrl(taskId: string) {
  return `/lane/tasks/${taskId}`;
}

function projectUrl(projectId: string) {
  return `/lane/projects/${projectId}`;
}

/** Open a task the way the demo intends it to be opened: click its row. */
async function openTaskPanel(page: Page, title: string) {
  await taskLink(page, title).click();
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
    .getByTestId("sidebar")
    .getByRole("link", { name: new RegExp(`^${escapeRegExp(name)}`) })
    .innerText();
  return Number(text.match(/\d+/)?.[0]);
}

async function sidebarCount(page: Page, label: string): Promise<number> {
  const text = await page
    .getByTestId("sidebar")
    .getByRole("link", { name: new RegExp(`^${escapeRegExp(label)}`) })
    .innerText();
  return Number(text.match(/\d+/)?.[0]);
}

async function gotoWorkspace(page: Page, path = LANE_ALL) {
  await page.goto(path);
  // App Router streaming and prefetches are allowed to keep network work in
  // flight. Wait for the actual interactive workspace instead of treating a
  // quiet transport as application readiness.
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(taskRows(page).first()).toBeVisible();
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

/** Change the status to a named one, for a test that cares which. */
async function chooseStatus(
  page: Page,
  control: ReturnType<Page["getByRole"]>,
  status: string,
) {
  await control.click();
  await page.getByRole("button", { name: status, exact: true }).click();
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
    await page.locator(`a[href="${LANE_ALL}"]`).click();
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
  await gotoWorkspace(page, LANE_ALL);

  const sessionReads = (await readRequestDiagnostics(request)).filter(
    (entry) => entry.origin === "server" && entry.path === "/api/me",
  );
  expect(sessionReads).toHaveLength(1);
});

test("regions stream independently rather than landing together", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(`a[href="${LANE_ALL}"]`).click();

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

  await taskLink(page, ACME_TASK).click();

  // Context is deliberately absent. Search/team remain because they refine the
  // workspace that a direct visit reconstructs behind the canonical task.
  await expect.poll(() => new URL(page.url()).pathname).toBe(
    taskUrl(ACME_TASK_ID),
  );
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(
    "billing",
  );
  // Clicked from a row, it is intercepted: the panel, with the list still there.
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(searchInput(page)).toHaveValue("billing");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("a reload reconstructs the same list and panel", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await searchInput(page).fill("billing");
  await expect(page).toHaveURL(/q=billing/);
  await openTaskPanel(page, ACME_TASK);

  await page.reload();

  // A fresh task request establishes All tasks first and then reopens the same
  // canonical URL through the list's interceptor.
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect.poll(() => new URL(page.url()).pathname).toBe(
    taskUrl(ACME_TASK_ID),
  );
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(
    "billing",
  );
  await expect(searchInput(page)).toHaveValue("billing");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(page).toHaveURL(`${LANE_ALL}?q=billing`);
});

test("clicking the open row again leaves the panel and the list alone", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await openTaskPanel(page, ACME_TASK);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  // Its href already is the current URL. The row prevents a redundant
  // navigation so the active intercepted tree remains untouched.
  await taskLink(page, ACME_TASK).click();

  await expect(page).toHaveURL(taskUrl(ACME_TASK_ID));
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("Back closes the panel and leaves the list standing", async ({ page }) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await openTaskPanel(page, ACME_TASK);

  await page.goBack();

  await expect(page).toHaveURL(new RegExp(`${LANE_ALL.replaceAll("/", "\\/")}(\\?|$)`));
  // Hidden, not gone: the router keeps the intercepted tree alive in a hidden
  // `<Activity>` so reopening it is instant (measured in activity-lab #96).
  await expect(detailPanel(page)).toBeHidden();
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("close backs out of the first task opened from a list", async ({ page }) => {
  await gotoWorkspace(page, `${LANE_ALL}?team=t_growth`);
  await openTaskPanel(page, GROWTH_TASK);
  expect(
    await page.evaluate(
      () =>
        (window.history.state as {
          __laneTaskNavigation?: { closeMode?: string };
        } | null)?.__laneTaskNavigation?.closeMode,
    ),
  ).toBe("back");

  // The list is immediately behind the first task, so close is a real Back.
  // The task entry remains in front and Forward can reveal it again.
  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(LANE_ALL);
  await page.goForward();
  await expect(detailTitle(page)).toHaveValue(GROWTH_TASK);
});

test("closing a task reached from another task pushes the retained list", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.locator(`a[href="${LANE_ALL}"]`).click();
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await openTaskPanel(page, ACME_TASK);

  // Task-to-task navigation is ordinary history: Back from the second task
  // still reveals the first one.
  await taskLink(page, ACME_INVOICE_TASK).click();
  await expect(detailTitle(page)).toHaveValue(ACME_INVOICE_TASK);
  await expect(page).toHaveURL(taskUrl(ACME_INVOICE_TASK_ID));

  // A: list → detail A → detail B → push(list). Closing is an ordinary App
  // Router push over the list that remains active behind both details.
  await resetRequestDiagnostics(request);
  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(LANE_ALL);
  await expect(detailPanel(page)).toBeHidden();
  expect(
    serverReadsOf(await readRequestDiagnostics(request), "/api/tasks"),
  ).toHaveLength(0);

  // The previous entry was another task, so close pushed the list. Neither task
  // was erased: Back walks through the task that closed, then the earlier one.
  await page.goBack();
  await expect(page).toHaveURL(taskUrl(ACME_INVOICE_TASK_ID));
  await expect(detailTitle(page)).toHaveValue(ACME_INVOICE_TASK);
  await page.goBack();
  await expect(page).toHaveURL(taskUrl(ACME_TASK_ID));
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
});

test("direct task bootstrap replaces history and close pushes the retained list", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const beforeDirect = await page.evaluate(() => window.history.length);

  await page.goto(taskUrl(ACME_TASK_ID));
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  const afterBootstrap = await page.evaluate(() => window.history.length);

  // The document navigation adds the task entry. Bootstrap replaces that same
  // entry; it must not add an artificial list → task pair.
  expect(afterBootstrap).toBe(beforeDirect + 1);

  // B: direct task → replace-bootstrap(list + intercepted detail) → push(list).
  // Reset after bootstrap so the measurement covers the close alone.
  await resetRequestDiagnostics(request);
  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(page).toHaveURL(LANE_ALL);
  expect(
    serverReadsOf(await readRequestDiagnostics(request), "/api/tasks"),
  ).toHaveLength(0);

  // Close pushed the list. Back therefore returns to the task, and one more
  // Back reaches the page before the direct landing — never a bootstrap list.
  await page.goBack();
  await expect(page).toHaveURL(taskUrl(ACME_TASK_ID));
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("a missing direct task can close to All tasks", async ({ page }) => {
  await page.goto(taskUrl("task_missing"));
  await expect(detailPanel(page).getByText("Task not found")).toBeVisible();

  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(page).toHaveURL(LANE_ALL);
  await expect(taskRows(page).first()).toBeVisible();
});

test("the legacy /lane entry keeps only supported workspace state", async ({
  page,
}) => {
  await page.goto(
    "/lane?team=t_growth&q=welcome&group=status&view=kanban&scope=mine&label=l_email",
  );
  await expect.poll(() => new URL(page.url()).pathname).toBe(LANE_ALL);

  const query = await page.evaluate(() =>
    Object.fromEntries(new URL(window.location.href).searchParams),
  );
  expect(query).toEqual({
    team: "t_growth",
    q: "welcome",
    group: "status",
  });
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

test("the sidebar selects named Context routes", async ({ page }) => {
  await gotoWorkspace(page);

  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: /^My tasks/ })
    .click();

  await expect(page).toHaveURL(`${LANE_ALL.replace(/all$/, "mine")}`);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(page.getByTestId("insight-strip")).toHaveCount(0);
});

test("a named Context stays mounted behind the canonical task URL", async ({ page }) => {
  await gotoWorkspace(page, "/lane/contexts/mine");

  await page.getByTestId("view-toolbar").evaluate((node) => {
    node.setAttribute("data-interception-probe", "standing");
  });

  await instant(page, async () => {
    await taskLink(page, ACME_TASK).click();

    // A named Context uses the same interception as All tasks. While the task
    // RSC is pending, the existing list stays visible; replacing the Context
    // page here would show its list fallback and discard this probe.
    await expect(page.getByTestId("task-list-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("view-toolbar")).toHaveAttribute(
      "data-interception-probe",
      "standing",
    );
  });

  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(page.getByTestId("view-toolbar")).toHaveAttribute(
    "data-interception-probe",
    "standing",
  );

  await expect(page).toHaveURL(taskUrl(ACME_TASK_ID));

  // The canonical URL does not encode its referrer. A hard load therefore uses
  // the documented default Context rather than guessing My tasks.
  await page.reload();
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(page).toHaveURL(LANE_ALL);
});

test("the sidebar stays mounted across Context routes", async ({ page }) => {
  await gotoWorkspace(page);
  await expect(page.getByTestId("sidebar")).toBeVisible();

  // A property placed directly on the DOM node survives only if the shared
  // workspace layout keeps that exact node. Reconstructing an identical
  // Sidebar under the next page would lose it (and show its Suspense fallback
  // while the slower reference-data publication lands).
  await page.getByTestId("sidebar").evaluate((node) => {
    node.setAttribute("data-persistence-probe", "standing");
  });

  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: /^Overdue/ })
    .click();

  await expect(page).toHaveURL(/\/lane\/contexts\/overdue$/);
  await expect(page.getByTestId("sidebar-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("sidebar")).toHaveAttribute(
    "data-persistence-probe",
    "standing",
  );
  await expect(taskRows(page).first()).toBeVisible();
});

test("Due soon uses the same open-task predicate as its sidebar count", async ({
  request,
}) => {
  const title = `E2E completed future task ${Date.now()}`;
  const headers = {
    "x-team-id": "t_acme",
    "x-user-id": "u_maya",
  };
  const created = await request.post("/api/tasks", {
    headers,
    data: {
      title,
      status: "done",
      priority: "none",
      dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    },
  });
  expect(created.status()).toBe(201);

  const [insightsResponse, tasksResponse] = await Promise.all([
    request.get("/api/insights", { headers }),
    request.get("/api/tasks?due=week&limit=100", { headers }),
  ]);
  expect(insightsResponse.ok()).toBe(true);
  expect(tasksResponse.ok()).toBe(true);

  const insights = await insightsResponse.json() as { dueSoon: number };
  const taskPage = await tasksResponse.json() as {
    items: Array<{ title: string }>;
  };

  expect(taskPage.items).toHaveLength(insights.dueSoon);
  expect(taskPage.items.map((task) => task.title)).not.toContain(title);
});

test("grouping and sorting change presentation without changing Context", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page, "/lane/contexts/mine");
  await resetRequestDiagnostics(request);

  await page.getByRole("button", { name: "Group: Priority" }).click();
  await page.getByRole("menuitem", { name: "Status" }).click();
  await expect(page).toHaveURL(/\/lane\/contexts\/mine\?group=status$/);
  await expect(page.locator('[data-group-key="in_progress"]')).toBeVisible();

  await page.getByRole("button", { name: "Sort: Default" }).click();
  await page.getByRole("menuitem", { name: "Title" }).click();
  await expect(page).toHaveURL(/group=status&sort=title/);
  await expect(page.getByRole("button", { name: "Sort: Title" })).toBeVisible();

  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(0);
});

test("a project is its own fixed workspace view", async ({ page }) => {
  await gotoWorkspace(page);

  await expect(
    page.getByTestId("view-toolbar").getByRole("button", {
      name: "Group: Priority",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("insight-strip")).toHaveCount(0);

  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: new RegExp(`^${BILLING_PROJECT}`) })
    .click();

  await expect(page).toHaveURL(projectUrl("p_billing"));
  await expect(page.getByTestId("project-header")).toContainText(
    BILLING_PROJECT,
  );
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(taskRow(page, "Interactive onboarding checklist")).toBeHidden();

  // Search refines the project view instead of falling back to All tasks.
  await searchInput(page).fill("invoice");
  await expect(page).toHaveURL(
    /\/lane\/projects\/p_billing\?q=invoice/,
  );
  await expect(taskRow(page, ACME_INVOICE_TASK)).toBeVisible();
  await expect(taskRow(page, ACME_TASK)).toBeHidden();
});

test("a project task opens in the panel and returns to its project", async ({
  page,
}) => {
  await page.goto(projectUrl("p_billing"));
  await expect(page.getByTestId("project-header")).toBeVisible();
  await openTaskPanel(page, ACME_TASK);

  await expect(page).toHaveURL(taskUrl(ACME_TASK_ID));
  await expect(page.getByTestId("project-header")).toBeVisible();

  // While the intercepted tree is alive, Back returns to the exact project.
  await page.goBack();
  await expect(page).toHaveURL(projectUrl("p_billing"));
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await openTaskPanel(page, ACME_TASK);
  // A hard load has no referrer Context in the canonical URL, so it rebuilds
  // the documented All tasks default instead of guessing a project.
  await page.reload();
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(page.getByTestId("project-header")).toHaveCount(0);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await detailPanel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(page).toHaveURL(LANE_ALL);
});

test("a load reads every dynamic source", async ({
  page,
  request,
}) => {
  // Each read runs once per render pass however many regions ask for it — the
  // task list and the filter bar share one `/api/tasks`, the sidebar and the
  // strip one `/api/insights`. The reference reads are dynamic too, so a warm
  // load still reaches each of their sources.
  await resetRequestDiagnostics(request);
  await gotoWorkspace(page, LANE_ALL);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(1);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(1);
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
    expect(
      serverReadsOf(records, path).length,
      `${path} on a warm load`,
    ).toBeGreaterThan(0);
  }
});

test("a rerender re-reads every published source", async ({
  page,
  request,
}) => {
  // A Context change renders the page publication again — the same source work
  // a create's rerender does. The shared Sidebar stays mounted while every
  // published read remains dynamic.
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await resetRequestDiagnostics(request);
  await page
    .getByTestId("sidebar")
    .getByRole("link", { name: /^My tasks/ })
    .click();
  await expect(page).toHaveURL(/\/lane\/contexts\/mine$/);
  await expect(page.getByTestId("task-list-skeleton")).toBeHidden();

  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, "/api/tasks").length).toBeGreaterThan(0);
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
    expect(
      serverReadsOf(records, path).length,
      `${path} on a rerender`,
    ).toBeGreaterThan(0);
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
  // And nothing behind it. The response carried the row and both derivations,
  // so the lane was `set` from it and no rerender was asked for at all.
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(0);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(0);
  expect(serverReadsOf(records, PROJECT_COUNTS_PATH)).toHaveLength(0);
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
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

/**
 * **The claim this route is now making**: an inline edit asks the owner for
 * nothing.
 *
 * The two counters are derived from the tasks table, so a client cannot compute
 * them — but the handler that just wrote the row can, and does, in the same
 * response. Every key the edit moves is `set` from that answer, `invalidate`
 * is not used, and the owner is never asked to render. What proves it is not
 * the count of renders but their absence: zero server-origin reads of any of
 * the three dynamic sources, while the named Context count moves.
 */
test("a task edit asks the owner for nothing", async ({ page, request }) => {
  await gotoWorkspace(page);
  const title = `E2E counter task ${Date.now()}`;
  await createTask(page, title);

  // "Completed" is the named Context count this status change moves.
  const beforeNav = await sidebarCount(page, "Completed");

  await resetRequestDiagnostics(request);
  await chooseStatus(
    page,
    detailPanel(page).getByRole("button", { name: /^Status:/ }),
    "Done",
  );
  await expect(page.getByText("Saved")).toBeVisible();

  await expect(async () => {
    expect(await sidebarCount(page, "Completed")).toBe(beforeNav + 1);
  }).toPass();

  // The numbers moved and the server was not asked a single question.
  const records = await readRequestDiagnostics(request);
  expect(
    records.filter(
      (entry) => entry.origin === "browser" && entry.method === "PATCH",
    ),
  ).toHaveLength(1);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(0);
  expect(serverReadsOf(records, PROJECT_COUNTS_PATH)).toHaveLength(0);
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(0);
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
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
  await expect(page).not.toHaveURL(/\/lane\/tasks\//);
  // The intercepted tree stays mounted but hidden after the view moves back to
  // the list (router keep-alive); what matters is that nothing shows it.
  await expect(detailPanel(page)).toBeHidden();

  const records = await readRequestDiagnostics(request);
  expect(
    records.filter(
      (entry) => entry.origin === "browser" && entry.method === "DELETE",
    ),
  ).toHaveLength(1);
  // And no rerender at all. The delete answered with the two counters, so
  // nothing was marked stale, nothing asked the owner to publish, and the
  // navigation back to the list reuses the segment the router already has.
  expect(serverReadsOf(records, "/api/tasks"), "tasks after a delete")
    .toHaveLength(0);
  expect(serverReadsOf(records, "/api/insights"), "insights after a delete")
    .toHaveLength(0);
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
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
  // The action rerendered the dynamic route, so reference data is read again
  // even though the new task did not change it.
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
    expect(
      serverReadsOf(records, path).length,
      `${path} after a create`,
    ).toBeGreaterThan(0);
  }
});

test("creating a label rerenders the dynamic route", async ({
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

  // The label is on the task. Labels no longer occupy the workspace nav; the
  // open picker is where the republished roster is visible.
  await expect(
    detailPanel(page).getByRole("button", { name: `Remove ${name}` }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name })).toBeVisible();

  const records = await readRequestDiagnostics(request);
  // The action calls `refresh()`, and every source published by the route is
  // dynamic. The new label arrives with that generation; unrelated reference
  // reads are deliberately repeated as well.
  for (const path of DYNAMIC_REFERENCE_READ_PATHS) {
    expect(
      serverReadsOf(records, path).length,
      `${path} after creating a label`,
    ).toBeGreaterThan(0);
  }
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

test("an edit after a hard task load converges into the visible list", async ({
  page,
  request,
}) => {
  await gotoWorkspace(page);
  await openTaskPanel(page, ACME_TASK);

  // Reload enters through the canonical route, rebuilds All tasks, and then
  // reopens the detail through the same interceptor used by a row click.
  await page.reload();
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await resetRequestDiagnostics(request);
  const next = await chooseAnotherStatus(
    page,
    detailPanel(page).getByRole("button", { name: /^Status:/ }),
  );
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(
    taskRow(page, ACME_TASK).getByRole("button", { name: `Status: ${next}` }),
  ).toBeVisible();

  // The mutation response patches the task, row, and derived counts. The hard
  // route uses the same convergence path as the intercepted panel.
  const afterEdit = await readRequestDiagnostics(request);
  expect(
    afterEdit.filter(
      (entry) => entry.origin === "browser" && entry.method === "PATCH",
    ),
  ).toHaveLength(1);
  expect(serverReadsOf(afterEdit, "/api/tasks")).toHaveLength(0);
  expect(serverReadsOf(afterEdit, "/api/insights")).toHaveLength(0);
});

/**
 * A project's task count is its own dynamic read and Lane key. The write that
 * moves it answers with the confirmed value, so the number follows the edit
 * without a route render or another read of the count.
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

  // The number came back with the write that moved it, so it cost no read of
  // its own — and the roster beside it was not read either: no tag was
  // expired, because none needed to be.
  const records = await readRequestDiagnostics(request);
  expect(serverReadsOf(records, PROJECT_COUNTS_PATH)).toHaveLength(0);
  expect(serverReadsOf(records, "/api/projects")).toHaveLength(0);

  // And back down when the task goes away.
  await resetRequestDiagnostics(request);
  await detailPanel(page).getByRole("button", { name: "Delete task" }).click();
  await expect(taskRow(page, title)).toBeHidden();

  await expect(async () => {
    expect(await projectCount(page, BILLING_PROJECT)).toBe(before);
  }).toPass();

  // A delete from the panel also moves the view back to the list, and there is
  // no refresh in flight for that navigation to abort: the delete answered with
  // the counters too. The old allowance for a re-asked render goes with the ask
  // that needed it — zero reads, on the nose, for the count and the roster.
  const afterDelete = await readRequestDiagnostics(request);
  expect(serverReadsOf(afterDelete, PROJECT_COUNTS_PATH)).toHaveLength(0);
  expect(serverReadsOf(afterDelete, "/api/projects")).toHaveLength(0);
});

test("opening a task keeps the list standing until the detail lands", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await page.getByTestId("view-toolbar").evaluate((node) => {
    node.setAttribute("data-detail-probe", "standing");
  });

  // The current Context remains the immediate UI while the task-only RSC is
  // pending. No whole-list fallback or remount is allowed on the way in.
  await instant(page, async () => {
    await taskLink(page, ACME_TASK).click();
    await expect(page.getByTestId("task-list-skeleton")).toHaveCount(0);
    await expect(page.getByTestId("view-toolbar")).toHaveAttribute(
      "data-detail-probe",
      "standing",
    );
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
  // page 1 — the one this test puts the depth through, since the edit that
  // follows produces none.
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
  // The depth survives for the simplest reason available: nothing republishes.
  // The edit converged from its own response, so no page 1 lands on top of the
  // pages the browser paid for — and neither half of the list is read again.
  expect(serverReadsOf(records, "/api/tasks")).toHaveLength(0);
  expect(serverReadsOf(records, "/api/insights")).toHaveLength(0);
  expect(browserReadsOf(records, "/api/tasks")).toHaveLength(0);
  // Both pages are still standing.
  expect((await rowOrder(page)).length).toBe(before.length);
});
