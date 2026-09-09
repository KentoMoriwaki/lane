import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    source: { value: number; loads: number; completed: number; pops: number };
    sampledFrames: { total: number; fallback: number; running: boolean };
  }
}

async function sampleFrames(page: Page) {
  await page.evaluate(() => {
    const frames = window.sampledFrames = { total: 0, fallback: 0, running: true };
    function sample() {
      if (!frames.running) return;
      frames.total++;
      if ([...document.querySelectorAll('[aria-busy="true"]')].some(node =>
        node instanceof HTMLElement && node.checkVisibility())) frames.fallback++;
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

async function finishFrames(page: Page) {
  // Observe beyond the delayed read and React's fallback throttle, including
  // real display opportunities. DOM insertion alone is not a painted fallback.
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => {
    window.sampledFrames.running = false;
    return window.sampledFrames;
  });
  expect(frames.total).toBeGreaterThan(0);
  expect(frames.fallback).toBe(0);
}

for (const flags of ["", "activity", "strict", "activity&strict&multiple", "multiple"]) {
  test(`warm Back/Forward refreshes without a painted fallback (${flags || "unmount"})`, async ({ page }) => {
    await page.goto(`/?${flags}#/tasks`);
    await expect(page.getByTestId("tasks").first()).toHaveText("Tasks 1");
    await expect.poll(() => page.evaluate(() => window.source.loads === window.source.completed)).toBe(true);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await expect(page.getByTestId("journal")).toBeVisible();

    for (const value of [2, 3]) {
      const before = await page.evaluate(value => {
        window.source.value = value;
        return { ...window.source };
      }, value);
      await sampleFrames(page);
      await page.goBack(); // Native history traversal: no synthetic popstate.
      await expect(page.getByTestId("tasks").first()).toHaveText(`Tasks ${value}`);
      await finishFrames(page);
      const after = await page.evaluate(() => ({ ...window.source }));
      expect(after.pops).toBeGreaterThan(before.pops);
      expect(after.loads - before.loads).toBe(1);
      expect(after.completed - before.completed).toBe(1);
      await sampleFrames(page);
      await page.goForward();
      await expect(page.getByTestId("journal")).toBeVisible();
      await finishFrames(page);
    }
  });
}

test("cold mount shows fallback, warm PUSH refreshes without fallback", async ({ page }) => {
  await page.goto("/#/tasks");
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(page.getByTestId("tasks")).toHaveText("Tasks 1");
  await expect.poll(() => page.evaluate(() => window.source.loads === window.source.completed)).toBe(true);
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  await expect(page.getByTestId("journal")).toBeVisible();
  await page.evaluate(() => { window.source.value = 2; });
  await sampleFrames(page);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByTestId("tasks")).toHaveText("Tasks 2");
  await finishFrames(page);
});

for (const flags of ["", "activity"]) {
  test(`warm Forward into Tasks refreshes without fallback (${flags || "unmount"})`, async ({ page }) => {
    await page.goto(`/?${flags}#/journal`);
    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page.getByTestId("tasks")).toHaveText("Tasks 1");
    await expect.poll(() => page.evaluate(() => window.source.loads === window.source.completed)).toBe(true);
    await page.goBack();
    await expect(page.getByTestId("journal")).toBeVisible();
    const before = await page.evaluate(() => {
      window.source.value = 2;
      return window.source.loads;
    });
    await sampleFrames(page);
    await page.goForward();
    await expect(page.getByTestId("tasks")).toHaveText("Tasks 2");
    await finishFrames(page);
    expect(await page.evaluate(() => window.source.loads)).toBe(before + 1);
  });

  test(`rapid Back/Forward during an in-flight refresh converges (${flags || "unmount"})`, async ({ page }) => {
    await page.goto(`/?${flags}#/tasks`);
    await expect(page.getByTestId("tasks")).toHaveText("Tasks 1");
    await expect.poll(() => page.evaluate(() => window.source.loads === window.source.completed)).toBe(true);
    await page.getByRole("link", { name: "Journal", exact: true }).click();
    await page.evaluate(() => { window.source.value = 2; });
    const before = await page.evaluate(() => window.source.loads);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.source.loads)).toBeGreaterThan(before);
    await page.goForward();
    await expect(page.getByTestId("journal")).toBeVisible();
    await page.goBack();
    // This traversal can encounter the still-pending replacement promise;
    // it is not a restore of a settled cache. Verify convergence, not a
    // universal no-fallback guarantee for navigating during active work.
    await expect(page.getByTestId("tasks")).toHaveText("Tasks 2");
    await expect.poll(() => page.evaluate(() => window.source.loads === window.source.completed)).toBe(true);
    await page.goForward();
    await expect(page.getByTestId("journal")).toBeVisible();
    const completed = await page.evaluate(() => window.source.loads);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.source.loads)).toBe(completed);
  });
}

test("refetchOnMount false restores the warm value without a new read", async ({ page }) => {
  await page.goto("/?no-refetch#/tasks");
  await expect(page.getByTestId("tasks")).toHaveText("Tasks 1");
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  const before = await page.evaluate(() => {
    window.source.value = 2;
    return window.source.loads;
  });
  await sampleFrames(page);
  await page.goBack();
  await expect(page.getByTestId("tasks")).toHaveText("Tasks 1");
  await finishFrames(page);
  expect(await page.evaluate(() => window.source.loads)).toBe(before);
});
