import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.describe.configure({ mode: "serial" });

async function unlockWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your access token." })).toBeVisible();
  await page.getByRole("textbox", { name: "Access token", exact: true }).fill("e2e-access-token");
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await expect(page.getByRole("heading", { name: "Know when the numbers stop making sense." })).toBeVisible();
}

test("imports a source, creates a rule, runs it, and resolves an issue", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The complete workflow runs once against the shared test server");
  await unlockWorkspace(page);
  await page.getByRole("link", { name: "Sources & rules" }).click();

  await page.locator('input[type="file"]').setInputFiles(resolve("examples/invoices-with-issues.csv"));
  await page.getByLabel("Source name").fill("Sample invoices");
  await page.getByRole("button", { name: "Import source" }).click();
  await expect(page.getByText("Sample invoices imported with 4 rows.")).toBeVisible();

  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule name").fill("Invoice ID is required");
  await page.getByRole("combobox", { name: "Check", exact: true }).selectOption("required");
  await page.getByRole("combobox", { name: "Column", exact: true }).selectOption("invoice_id");
  await page.getByRole("combobox", { name: "Severity", exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Validation rule added.")).toBeVisible();

  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Check complete with a score of 75.")).toBeVisible();
  await page.getByRole("link", { name: "Issue desk" }).click();
  await expect(page.getByRole("cell", { name: "Required value is missing Invoice ID is required" })).toBeVisible();

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.getByLabel(/What changed/).fill("Corrected in the source workbook");
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Issue marked resolved.")).toBeVisible();
  await expect(page.getByText("No open issues")).toBeVisible();
});

test("keeps primary navigation usable on a narrow viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-specific viewport check");
  await unlockWorkspace(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByLabel("Primary navigation")).toBeVisible();
  await page.getByRole("link", { name: "Run history" }).click();
  await expect(page.getByRole("heading", { name: "Run history", exact: true })).toBeVisible();
  const bodyWidth = await page.locator("body").evaluate((element) => element.scrollWidth);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
});
