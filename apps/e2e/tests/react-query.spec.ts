import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

const ACME_TASK = "Review billing webhook retry behavior";

function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(title) });
}

test("the hydrated client-owned baseline exposes an instant workspace shell", async ({
  page,
}) => {
  await page.goto("/");

  await instant(page, async () => {
    await page.locator('a[href="/react-query"]').click();
    await expect(page.getByTestId("react-query-workspace-shell")).toBeVisible();
    await expect(
      page.getByLabel("Loading React Query workspace"),
    ).toBeVisible();
  });

  await expect(taskRow(page, ACME_TASK)).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId("react-query-workspace-shell")).toBeHidden();
});
