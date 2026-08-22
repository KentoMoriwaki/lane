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
const ACME_COMPLETED_TASK = "Responsive navigation for small screens";
const GROWTH_TASK = "Welcome email rewrite";

const SEARCH_PLACEHOLDER = "Search tasks, labels…";

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A task list row: a button whose accessible name is "Status: <s> <title> …". */
function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(escapeRegExp(title)) });
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

test("status change converges across detail, list, and insights", async ({
  page,
}) => {
  await gotoWorkspace(page);

  // A fresh task keeps this test independent from previous runs.
  const title = `E2E status task ${Date.now()}`;
  await createTask(page, title);

  const inProgressCard = page.getByRole("link", { name: /In progress/ });
  await expect(inProgressCard).toBeVisible();
  const before = Number((await inProgressCard.innerText()).match(/\d+/)?.[0]);

  // Created tasks start as Todo; move it to In progress from the detail panel.
  await detailPanel(page)
    .getByRole("button", { name: "Status: Todo" })
    .click();
  await page.getByRole("button", { name: "In progress", exact: true }).click();

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(
    detailPanel(page).getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();

  // Derived insights converge through invalidation.
  await expect(async () => {
    const text = await inProgressCard.innerText();
    expect(Number(text.match(/\d+/)?.[0])).toBe(before + 1);
  }).toPass();
});

test("creating a task shows it in the list and opens the detail", async ({
  page,
}) => {
  await gotoWorkspace(page);

  const title = `E2E created task ${Date.now()}`;
  await createTask(page, title);

  // The task list converges with the new row.
  await expect(taskRow(page, title)).toBeVisible();
});

test("a title-only update republishes the task and its list row", async ({
  page,
}) => {
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

  // Break the refresh where it actually travels: the workspace is server-owned,
  // so the refresh button is a server action (a POST to the page), not a
  // browser-side /api fetch. The store keeps its published values, so the rows
  // must stay rendered while the chip reports the failure.
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
