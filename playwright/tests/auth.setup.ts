import { test as setup, expect } from "@playwright/test";

setup("sign in and store session", async ({ page }) => {
  await page.goto("/auth/signin");

  const emailInput = page.getByRole("textbox", { name: "Email" });
  await expect(emailInput).toBeVisible();

  await emailInput.fill("test@test.pl");

  await expect(emailInput).toHaveValue("test@test.pl");

  await page.getByRole("textbox", { name: "Password" }).fill("test123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("/decks");

  await page.context().storageState({ path: "playwright/.auth/user.json" });
});
