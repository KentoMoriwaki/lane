import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

const ACME_TEAM = "Acme Product Team";
const GROWTH_TEAM = "Growth Pod";
const ACME_TASK = "Review billing webhook retry behavior";
const ACME_TASK_ID = "task_webhook";
const ACME_INVOICE_TASK = "Generate downloadable invoice PDFs";
const ACME_COMPLETED_TASK = "Responsive navigation for small screens";
const GROWTH_TASK = "Welcome email rewrite";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(escapeRegExp(title)) });
}

function detailPanel(page: Page) {
  return page.locator("aside").filter({ has: page.locator("textarea") });
}

function detailTitle(page: Page) {
  return detailPanel(page).getByLabel("Task title");
}

async function gotoWorkspace(page: Page, path = "/app-router") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function createTask(page: Page, title: string) {
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(detailTitle(page)).toHaveValue(title);
}

test("the cold props baseline converges without client-demo latency", async ({
  page,
}) => {
  const startedAt = Date.now();
  await gotoWorkspace(page);
  expect(Date.now() - startedAt).toBeLessThan(3_000);
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});

test("the props baseline exposes an instant workspace shell", async ({
  page,
}) => {
  await page.goto("/");
  await instant(page, async () => {
    await page.locator('a[href="/app-router"]').click();
    await expect(page.getByTestId("app-router-workspace-shell")).toBeVisible();
    await expect(page.getByLabel("Loading App Router workspace")).toBeVisible();
  });
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
  await expect(page.getByTestId("app-router-workspace-shell")).toBeHidden();
});

test("intent prefetch resolves a filtered props publication before click", async ({
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
  await expect(taskRow(page, ACME_COMPLETED_TASK)).toBeVisible();
  await expect(taskRow(page, ACME_TASK)).toBeHidden();
  expect(navigationRequests).toEqual([]);
});

test("a search commit merges onto the current view", async ({ page }) => {
  await gotoWorkspace(page);
  const completedLink = page
    .locator("aside")
    .getByRole("link", { name: /Completed/ });
  const prefetchResponse = page.waitForResponse(
    (response) =>
      response.url().includes("status=done") &&
      response.request().headers()["next-router-prefetch"] === "2",
  );
  await completedLink.hover();
  await prefetchResponse;
  await completedLink.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("status"))
    .toBe("done");
  const search = page.getByPlaceholder("Search tasks, labels…");
  await search.fill("bill");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("bill");
  await expect(search).toHaveValue("bill");
});

test("multi filters, project, label, due and team navigation keep URL semantics", async ({
  page,
}) => {
  await gotoWorkspace(page);
  const filterBar = page.getByTestId("app-router-filter-bar");

  await filterBar.getByRole("button", { name: "Status", exact: true }).click();
  await page.getByRole("menuitem", { name: "Todo", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "In progress", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await filterBar
    .getByRole("button", { name: "Priority", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Urgent", exact: true }).click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await page.keyboard.press("Escape");

  await expect
    .poll(() => new URL(page.url()).searchParams.get("status"))
    .toBe("todo,in_progress");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("priority"))
    .toBe("urgent,high");
  await page.reload();
  await expect(
    filterBar.getByRole("button", { name: /Status 2/ }),
  ).toBeVisible();
  await expect(
    filterBar.getByRole("button", { name: /Priority 2/ }),
  ).toBeVisible();

  await page
    .locator("aside")
    .getByRole("link", { name: /Billing/ })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("project"))
    .toBe("p_billing");
  await page
    .locator("aside")
    .getByRole("link", { name: "backend", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("label"))
    .toBe("l_backend");
  await page
    .locator("aside")
    .getByRole("link", { name: /Due soon/ })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("due"))
    .toBe("week");

  await page.getByRole("button", { name: new RegExp(ACME_TEAM) }).click();
  await page.getByRole("menuitem", { name: new RegExp(GROWTH_TEAM) }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("team"))
    .toBe("t_growth");
  await expect(taskRow(page, GROWTH_TASK)).toBeVisible();
  await expect(taskRow(page, ACME_TASK)).toBeHidden();
});

test("selection survives reload and Back closes the detail", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await taskRow(page, ACME_TASK).click();
  await expect(page).toHaveURL(new RegExp(`task=${ACME_TASK_ID}`));
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await page.reload();
  await expect(detailTitle(page)).toHaveValue(ACME_TASK);
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("task"))
    .toBeNull();
  await expect(page.getByText("No task selected")).toBeVisible();
});

test("detail mutation is optimistic and converges through its Server Action", async ({
  page,
}) => {
  await gotoWorkspace(page);
  const title = `App Router optimistic ${Date.now()}`;
  await createTask(page, title);

  let releaseRequest!: () => void;
  let markStarted!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route("**/app-router**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    markStarted();
    await requestGate;
    await route.fallback();
  });

  await detailPanel(page).getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("button", { name: "In progress", exact: true }).click();
  await requestStarted;
  await expect(
    detailPanel(page).getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  releaseRequest();
  await expect(detailPanel(page).getByText("Saved")).toBeVisible();
  await page.unroute("**/app-router**");
});

test("selected row deletion rolls back on failure then clears selection on success", async ({
  page,
}) => {
  await gotoWorkspace(page);
  const title = `App Router delete ${Date.now()}`;
  await createTask(page, title);
  await expect(page).toHaveURL(/task=/);

  await page.route("**/app-router**", (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.fallback(),
  );
  await taskRow(page, title).hover();
  await taskRow(page, title)
    .getByRole("button", { name: "Task actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await expect(page.getByText("Couldn't delete task")).toBeVisible();
  await expect(taskRow(page, title)).toBeVisible();
  await expect(detailTitle(page)).toHaveValue(title);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("task"))
    .not.toBeNull();
  await page.unroute("**/app-router**");

  let releaseRequest!: () => void;
  let markStarted!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route("**/app-router**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    markStarted();
    await requestGate;
    await route.fallback();
  });
  await taskRow(page, title).hover();
  await taskRow(page, title)
    .getByRole("button", { name: "Task actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await requestStarted;
  await expect(taskRow(page, title)).toBeHidden();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("task"))
    .not.toBeNull();
  releaseRequest();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("task"))
    .toBeNull();
  await expect(page.getByText("Task unavailable")).toBeHidden();
  await page.unroute("**/app-router**");
});

test("failed manual refresh keeps props visible and retry recovers", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await page.route("**/app-router**", (route) =>
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
  await page.unroute("**/app-router**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Couldn't refresh")).toBeHidden();
  await expect(taskRow(page, ACME_TASK)).toBeVisible();
});
