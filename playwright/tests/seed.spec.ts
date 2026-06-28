// seed.spec.ts
import { test, expect } from "@playwright/test";

test("created deck persists after page reload", async ({ page }) => {
  const deckName = `Test Deck ${Date.now()}`;
  await page.goto("/");

  await page.getByRole("button", { name: "+ Add deck" }).click();
  await page.getByRole("textbox", { name: "Deck name" }).fill(deckName);
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByRole("link", { name: deckName })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: deckName })).toBeVisible();

  // Cleanup
  const deckRow = page.getByRole("listitem").filter({ hasText: deckName });
  await deckRow.getByRole("button", { name: "More actions" }).click();
  await deckRow.getByRole("menuitem", { name: "Delete" }).click();
});
