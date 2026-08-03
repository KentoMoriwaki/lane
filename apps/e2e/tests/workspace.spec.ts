import { expect, test, type Page } from "@playwright/test";
import { instant } from "@next/playwright";
import { getTaskUpdateDerivedImpact } from "../../demo/src/app/lane/api/cache-policy";

// Seeded data from apps/demo/src/server/team/db.ts
const ACME_TEAM = "Acme Product Team";
const GROWTH_TEAM = "Growth Pod";
const ACME_TASK = "Review billing webhook retry behavior";
const ACME_TASK_ID = "task_webhook";
const ACME_INVOICE_TASK = "Generate downloadable invoice PDFs";
const ACME_COMPLETED_TASK = "Responsive navigation for small screens";
const GROWTH_TASK = "Welcome email rewrite";

const SEARCH_PLACEHOLDER = "Search tasks, labels…";

test("task update invalidation follows derived-data dependencies", () => {
  expect(getTaskUpdateDerivedImpact({ title: "Renamed" })).toEqual({
    insights: false,
    projects: false,
  });
  expect(getTaskUpdateDerivedImpact({ priority: "urgent" })).toEqual({
    insights: false,
    projects: false,
  });
  expect(getTaskUpdateDerivedImpact({ status: "done" })).toEqual({
    insights: true,
    projects: false,
  });
  expect(getTaskUpdateDerivedImpact({ assigneeId: null })).toEqual({
    insights: true,
    projects: false,
  });
  expect(getTaskUpdateDerivedImpact({ dueDate: null })).toEqual({
    insights: true,
    projects: false,
  });
  expect(getTaskUpdateDerivedImpact({ projectId: null })).toEqual({
    insights: false,
    projects: true,
  });
});

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

test("the server-owned route exposes a workspace shell instantly", async ({
  page,
}) => {
  await page.goto("/");

  await instant(page, async () => {
    await page.locator('a[href="/lane"]').click();
    await expect(page.getByTestId("lane-workspace-shell")).toBeVisible();
    await expect(page.getByLabel("Loading workspace")).toBeVisible();
  });

  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(page.getByTestId("lane-workspace-shell")).toBeHidden();
});

test("intent prefetch resolves a filtered publication before the click", async ({
  page,
}) => {
  await gotoWorkspace(page);

  const completedLink = page
    .locator("aside")
    .getByRole("link", { name: /Completed/ });
  const prefetchResponse = page.waitForResponse((response) => {
    const headers = response.request().headers();
    return (
      response.url().includes("status=done") &&
      headers["next-router-prefetch"] === "2"
    );
  });

  await completedLink.hover();
  await prefetchResponse;

  const navigationRequests: string[] = [];
  page.on("request", (request) => {
    const headers = request.headers();
    if (
      request.url().includes("status=done") &&
      headers.rsc === "1" &&
      !headers["next-router-prefetch"]
    ) {
      navigationRequests.push(request.url());
    }
  });

  await completedLink.click();
  await expect(page).toHaveURL(/status=done/);
  await expect(taskRow(page, ACME_COMPLETED_TASK)).toBeVisible();
  await expect(taskRow(page, ACME_TASK)).toBeHidden();
  await expect(page.getByTestId("lane-workspace-shell")).toBeHidden();
  expect(navigationRequests).toEqual([]);
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
