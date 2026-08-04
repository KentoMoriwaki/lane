import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

const ACME_TASK = "Review billing webhook retry behavior";

const SPA_VARIANTS = [
  {
    path: "/lane-spa",
    shellTestId: "lane-spa-workspace-shell",
    shellLabel: "Loading Lane SPA workspace",
  },
  {
    path: "/react-query",
    shellTestId: "react-query-spa-workspace-shell",
    shellLabel: "Loading React Query SPA workspace",
  },
] as const;

function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(title) });
}

function detailTitle(page: Page) {
  return page
    .locator("aside")
    .filter({ has: page.locator("textarea") })
    .locator("textarea")
    .first();
}

for (const variant of SPA_VARIANTS) {
  test(`${variant.path} keeps workspace data out of SSR and fetches it in the browser`, async ({
    page,
    request,
  }) => {
    const response = await request.get(variant.path);
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toContain(`data-testid="${variant.shellTestId}"`);
    expect(html).not.toContain(ACME_TASK);
    expect(html).not.toContain("Maya Chen");

    const browserApiGets: string[] = [];
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (
        browserRequest.method() === "GET" &&
        url.pathname.startsWith("/api/")
      ) {
        browserApiGets.push(url.pathname + url.search);
      }
    });

    await page.goto("/");
    await instant(page, async () => {
      await page.locator(`a[href="${variant.path}"]`).click();
      await expect(page.getByTestId(variant.shellTestId)).toBeVisible();
      await expect(page.getByLabel(variant.shellLabel)).toBeVisible();
    });

    await expect(taskRow(page, ACME_TASK)).toBeVisible();
    await expect(page.getByTestId(variant.shellTestId)).toBeHidden();
    expect(browserApiGets).toContain("/api/me");
    expect(browserApiGets.some((url) => url.startsWith("/api/tasks"))).toBe(
      true,
    );
  });

  test(`${variant.path} refreshes the open detail editor when the tab regains focus`, async ({
    context,
    page,
  }) => {
    const initialTitle = `${variant.path} focus source ${Date.now()}`;
    const updatedTitle = `${variant.path} focus result ${Date.now()}`;

    await page.goto(variant.path);
    await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByPlaceholder("Task title").fill(initialTitle);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(detailTitle(page)).toHaveValue(initialTitle);

    const editorPage = await context.newPage();
    await editorPage.goto(variant.path);
    await expect(taskRow(editorPage, initialTitle)).toBeVisible();
    await taskRow(editorPage, initialTitle).click();

    const updateResponse = editorPage.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.startsWith("/api/tasks/"),
    );
    await detailTitle(editorPage).fill(updatedTitle);
    await detailTitle(editorPage).blur();
    await updateResponse;

    // Make the first page's task entry stale while it remains in the background.
    await editorPage.waitForTimeout(5_100);
    await page.bringToFront();
    // Headless Chromium keeps every Page visible, so switching Pages does not
    // emit the browser signal that a real tab switch does.
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(taskRow(page, updatedTitle)).toBeVisible();
    await expect(detailTitle(page)).toHaveValue(updatedTitle);
  });
}

test("Lane SPA keeps a newer title draft when an earlier save completes", async ({
  page,
}) => {
  const initialTitle = `Lane edit source ${Date.now()}`;
  const submittedTitle = `Lane submitted ${Date.now()}`;
  const newerDraft = `Lane newer draft ${Date.now()}`;
  let releaseWrite!: () => void;
  let markWriteStarted!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
  });
  const writeCanFinish = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });

  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }

    markWriteStarted();
    await writeCanFinish;
    await route.continue();
  });

  await page.goto("/lane-spa");
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("Task title").fill(initialTitle);
  await page.getByRole("button", { name: "Create task" }).click();

  const title = detailTitle(page);
  await expect(title).toHaveValue(initialTitle);
  await title.fill(submittedTitle);
  await title.blur();
  await writeStarted;

  const detail = page
    .locator("aside")
    .filter({ has: page.locator("textarea") });
  await expect(detail.getByText("Saving…")).toBeVisible();
  await expect(
    detail
      .getByRole("button", { name: "Unassigned", exact: true })
      .locator(".animate-spin"),
  ).toHaveCount(0);
  await expect(
    detail
      .getByRole("button", { name: "No project", exact: true })
      .locator(".animate-spin"),
  ).toHaveCount(0);

  await title.focus();
  await title.fill(newerDraft);
  releaseWrite();

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(title).toHaveValue(newerDraft);
});

test("React Query SPA converges a mutation with browser invalidation", async ({
  page,
}) => {
  await page.goto("/react-query");
  await expect(taskRow(page, ACME_TASK)).toBeVisible();

  const title = `React Query SPA mutation ${Date.now()}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(taskRow(page, title)).toBeVisible();

  const browserApiGets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/")) {
      browserApiGets.push(url.pathname + url.search);
    }
  });

  const detail = page.locator("aside").filter({ has: page.locator("textarea") });
  await detail.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("button", { name: "In progress", exact: true }).click();

  await expect(
    detail.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  await expect(page.getByText("Saved")).toBeVisible();
  await expect
    .poll(() => browserApiGets.includes("/api/insights"))
    .toBe(true);
  // The optimistic task result is safe for this unfiltered list. Only the
  // derived aggregate needs a round trip; refetching the task/list is noise.
  expect(browserApiGets.some((url) => url.startsWith("/api/tasks"))).toBe(
    false,
  );
});
