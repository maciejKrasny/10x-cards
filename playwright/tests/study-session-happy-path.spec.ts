// study-session-happy-path.spec.ts
//
// Risk anchor: context/foundation/test-plan.md §2 Risk #4 — "SR review session
// loses today's progress mid-session, persists a stale review, or surfaces the
// wrong next-due card."
//
// Pattern source: playwright/tests/seed.spec.ts (role-based locators, unique
// test data per run, inline cleanup). Auth is supplied by the `setup` project's
// storageState — no UI login.

import { test, expect } from "@playwright/test";
import { createStudyDeck, deleteStudyDeck } from "./study-fixtures";

test.describe("SR review session happy path (Risk #4)", () => {
  let deckId: string;

  test.beforeEach(async ({ page }) => {
    const result = await createStudyDeck(page.request, `E2E SR happy ${Date.now()}`, [
      { front: "happy-front-1", back: "happy-back-1" },
      { front: "happy-front-2", back: "happy-back-2" },
    ]);
    deckId = result.deckId;
  });

  test.afterEach(async ({ page }) => {
    await deleteStudyDeck(page.request, deckId);
  });

  test("reveals + rates two cards and renders the summary with both ticks", async ({ page }) => {
    // Open the session.
    await page.goto(`/study/${deckId}`);

    // First card: reveal then rate Good.
    await page.getByRole("button", { name: "Show answer (Space)" }).click();
    await page.getByRole("button", { name: /3\.\s*Good/ }).click();

    // The reveal button reappears once the next card's front is rendered,
    // which proves the first POST settled and the UI advanced.
    await expect(page.getByRole("button", { name: "Show answer (Space)" })).toBeVisible();

    // Second card: reveal then rate Good.
    await page.getByRole("button", { name: "Show answer (Space)" }).click();
    await page.getByRole("button", { name: /3\.\s*Good/ }).click();

    // Summary renders with both ticks accounted for.
    await expect(page.getByText(/Reviewed 2 cards/i)).toBeVisible();
    await expect(page.getByText("Good: 2")).toBeVisible();
  });
});
