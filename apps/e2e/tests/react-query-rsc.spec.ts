import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

const ACME_TASK = "Review billing webhook retry behavior";
const TODO_TASK = "Generate downloadable invoice PDFs";
const FILTERED_TODO_TASK = "Design calmer empty states";

function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(title) });
}

test("the hydrated Next-converged variant exposes an instant workspace shell", async ({
  page,
}) => {
  await page.goto("/");

  await instant(page, async () => {
    await page.locator('a[href="/react-query-rsc"]').click();
    await expect(page.getByTestId("react-query-workspace-shell")).toBeVisible();
    await expect(
      page.getByLabel("Loading React Query workspace"),
    ).toBeVisible();
  });

  await expect(taskRow(page, ACME_TASK)).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId("react-query-workspace-shell")).toBeHidden();
});

test("an optimistic task update converges through RSC hydration without a browser GET", async ({
  page,
}) => {
  await page.goto(`/react-query-rsc?task=task_invoice_pdf`);
  await page.waitForLoadState("networkidle");

  const row = taskRow(page, TODO_TASK);
  const detail = page.locator("aside").filter({ has: page.locator("textarea") });
  const inProgressCard = page.getByRole("button", {
    name: /^In progress \d+/,
  });
  const detailUpdatedAt = detail.locator("[data-task-updated-at]");
  const before = Number((await inProgressCard.innerText()).match(/\d+/)?.[0]);
  await expect(row).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();
  const initialDetailTimestamp = await detailUpdatedAt.getAttribute(
    "data-task-updated-at",
  );

  // Start observing only after initial hydration. Internal API work performed
  // by the co-located Next server is not visible here; any matching request is
  // therefore a browser queryFn trying to converge the mutation itself.
  const browserApiGets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/")) {
      browserApiGets.push(url.pathname + url.search);
    }
  });

  let releaseAction!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  let markActionHeld!: () => void;
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });

  await page.route("**/react-query-rsc**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    markActionHeld();
    await actionGate;
    await route.continue();
  });

  await detail.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("button", { name: "In progress", exact: true }).click();
  await actionHeld;

  // `onMutate` has advanced the single browser store while the Server Action
  // is still held. Both observers keep showing that optimistic generation.
  await expect(
    detail.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  const optimisticDetailTimestamp = await detailUpdatedAt.getAttribute(
    "data-task-updated-at",
  );
  const optimisticRowTimestamp = await row.getAttribute(
    "data-task-updated-at",
  );
  expect(optimisticDetailTimestamp).not.toBe(initialDetailTimestamp);
  await page.waitForTimeout(300);
  await expect(
    detail.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  expect(Number((await inProgressCard.innerText()).match(/\d+/)?.[0])).toBe(
    before,
  );

  releaseAction();

  // Insights have no optimistic patch. Their change proves the action response
  // committed a newer dehydrated generation, while task detail and list remain
  // converged after HydrationBoundary's effect-time merge of existing queries.
  await expect(async () => {
    const text = await inProgressCard.innerText();
    expect(Number(text.match(/\d+/)?.[0])).toBe(before + 1);
  }).toPass();
  await expect(
    detail.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  await expect(detailUpdatedAt).not.toHaveAttribute(
    "data-task-updated-at",
    optimisticDetailTimestamp ?? "",
  );
  const serverTimestamp = await detailUpdatedAt.getAttribute(
    "data-task-updated-at",
  );
  expect(serverTimestamp).not.toBeNull();
  expect(serverTimestamp).not.toBe(optimisticRowTimestamp);
  await expect(row).toHaveAttribute(
    "data-task-updated-at",
    serverTimestamp ?? "",
  );
  await expect(page.getByText("Saved")).toBeVisible();
  await page.waitForTimeout(250);

  expect(browserApiGets).toEqual([]);
});

test("RSC hydration removes a task from an affected filtered query", async ({
  page,
}) => {
  await page.goto("/react-query-rsc?status=todo&task=task_empty_states");
  await page.waitForLoadState("networkidle");

  const row = taskRow(page, FILTERED_TODO_TASK);
  const detail = page
    .locator("aside")
    .filter({ has: page.locator("textarea") });
  await expect(row).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();

  const browserApiGets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/")) {
      browserApiGets.push(url.pathname + url.search);
    }
  });

  await detail.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("button", { name: "In progress", exact: true }).click();

  // `onMutate` deliberately leaves membership-sensitive lists untouched. The
  // row disappears only when the action's new dehydrated generation commits.
  await expect(row).toBeHidden();
  await expect(
    detail.getByRole("button", { name: "Status: In progress" }),
  ).toBeVisible();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.waitForTimeout(250);

  expect(browserApiGets).toEqual([]);
});
