import { expect, test, type Page } from "@playwright/test";

// Seeded data from apps/demo/src/server/team/db.ts
const ACME_TEAM = "Acme Product Team";
const GROWTH_TEAM = "Growth Pod";
const ACME_TASK = "Review billing webhook retry behavior";
const ACME_TASK_ID = "task_webhook";
const ACME_INVOICE_TASK = "Generate downloadable invoice PDFs";
const GROWTH_TASK = "Welcome email rewrite";

const SEARCH_PLACEHOLDER = "Search tasks, labels…";

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

  // Break only the tasks read; the refresh button invalidates it and the
  // client refetch fails. Stale-on-error must keep the rows rendered.
  await page.route("**/api/tasks**", (route) => route.abort("failed"));

  await expect(async () => {
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(page.getByText("Couldn't refresh")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });

  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  await page.unroute("**/api/tasks**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();

  await expect(page.getByText("Couldn't refresh")).toBeHidden();
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});
