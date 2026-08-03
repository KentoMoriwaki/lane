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
}

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
