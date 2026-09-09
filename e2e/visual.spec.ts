import { test, expect, type Page } from "@playwright/test";

async function waitOpDone(page: Page) {
  await expect(page.getByTestId("stage")).toHaveAttribute("data-phase", "done", {
    timeout: 20_000,
  });
}

async function setSpeedFast(page: Page) {
  const num = page.locator('.ctrl:has-text("Step speed") input.num');
  await num.fill("150");
  await num.blur();
}

async function addKey(page: Page, key: string) {
  await page.getByTestId("key-input").fill(key);
  await page.getByTestId("btn-add").click();
  await waitOpDone(page);
}

test.describe("Bloom filter visual", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("stage")).toBeVisible();
    await expect(page.getByTestId("bitgrid")).toBeVisible();
    await expect(page.getByTestId("side")).toBeVisible();
    await setSpeedFast(page);
  });

  test("initial 16:9 stage shows 20 bits + sidebar", async ({ page }) => {
    await expect(page.getByTestId("bit-0")).toBeVisible();
    await expect(page.getByTestId("bit-19")).toBeVisible();
    const bit19 = await page.getByTestId("bit-19").boundingBox();
    expect(bit19).toBeTruthy();
    expect(bit19!.x + bit19!.width).toBeLessThanOrEqual(1280);

    const side = await page.getByTestId("side").boundingBox();
    expect(side).toBeTruthy();
    expect(side!.x).toBeGreaterThan(500);

    await expect(page.getByTestId("stage")).toHaveScreenshot("initial.png");
  });

  test("layout stays intact after adding foo then bar", async ({ page }) => {
    await addKey(page, "foo");
    await expect(page.getByTestId("status")).toContainText(/Added/);
    await expect(page.getByTestId("bit-0")).toBeVisible();
    await expect(page.getByTestId("bit-19")).toBeVisible();
    await expect(page.getByTestId("side")).toBeVisible();
    await expect(page.getByTestId("stage")).toHaveScreenshot("after-foo.png");

    await addKey(page, "bar");
    await expect(page.getByTestId("status")).toContainText(/Added.*bar|Added “bar”/);

    const bit0 = await page.getByTestId("bit-0").boundingBox();
    const bit19 = await page.getByTestId("bit-19").boundingBox();
    const side = await page.getByTestId("side").boundingBox();
    expect(bit0 && bit19 && side).toBeTruthy();
    // hero bit row is full-width; controls sit in the bottom-right rail
    expect(side!.y).toBeGreaterThan(bit19!.y);
    expect(Math.abs(bit0!.y - bit19!.y)).toBeLessThan(4);
    expect(bit19!.x + bit19!.width).toBeLessThanOrEqual(1280);

    const stage = await page.getByTestId("stage").boundingBox();
    expect(stage!.width).toBeLessThanOrEqual(1280 + 1);
    expect(stage!.height).toBeLessThanOrEqual(720 + 1);

    // bitgrid still has exactly 20 cells
    await expect(page.locator('[data-testid^="bit-"]')).toHaveCount(20);

    await expect(page.getByTestId("stage")).toHaveScreenshot("after-foo-bar.png");
  });

  test("metrics and controls remain visible during probe", async ({ page }) => {
    const num = page.locator('.ctrl:has-text("Step speed") input.num');
    await num.fill("800");
    await num.blur();

    await page.getByTestId("key-input").fill("foo");
    await page.getByTestId("btn-add").click();
    await expect(page.getByTestId("stage")).toHaveAttribute("data-phase", /hash|probe/);
    await expect(page.getByTestId("metrics")).toBeVisible();
    await expect(page.getByTestId("side")).toBeVisible();
    await expect(page.getByTestId("bitgrid")).toBeVisible();
    await waitOpDone(page);
  });
});
