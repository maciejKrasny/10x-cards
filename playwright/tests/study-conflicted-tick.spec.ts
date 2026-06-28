// study-conflicted-tick.spec.ts
//
// Risk anchor: context/foundation/test-plan.md §2 Risk #4 — "SR review session
// loses today's progress mid-session, persists a stale review…". This spec
// covers the browser-level half of Risk #4's idempotency property: a same-
// review_at retry must NOT double-tick the counter.
//
// Pattern source: playwright/tests/seed.spec.ts (role-based locators, unique
// test data per run, inline cleanup). The retry simulation relies on
// supabase/migrations/20260617192636_record_review_return_conflicted.sql,
// which made the record_review RPC return { card, conflicted } so the UI can
// distinguish a true insert from an ON CONFLICT DO NOTHING dedupe.
//
// Two-card deck is intentional: card 1 proves the counter CAN tick (positive
// assertion), then card 2 proves a conflicted response does NOT tick again
// (negative assertion). A one-card deck would force an indirect
// "absence-proves-guard" assertion that is fragile.

import { test, expect } from "@playwright/test";
import { createStudyDeck, deleteStudyDeck } from "./study-fixtures";

test.describe("SR review write — conflicted: true skips counter tick (Risk #4)", () => {
  let deckId: string;

  test.beforeEach(async ({ page }) => {
    const result = await createStudyDeck(page.request, `E2E SR conflicted ${Date.now()}`, [
      { front: "conflict-front-1", back: "conflict-back-1" },
      { front: "conflict-front-2", back: "conflict-back-2" },
    ]);
    deckId = result.deckId;
  });

  test.afterEach(async ({ page }) => {
    await deleteStudyDeck(page.request, deckId);
  });

  test("second card's review replayed by the network leaves the counter at 1", async ({ page }) => {
    // Open the session and rate the first card normally to advance the queue.
    await page.goto(`/study/${deckId}`);
    await page.getByRole("button", { name: "Show answer (Space)" }).click();
    await page.getByRole("button", { name: /3\.\s*Good/ }).click();

    // The reveal button reappears once the next card's front is rendered,
    // which proves the first POST settled and the counter has ticked to 1.
    await expect(page.getByRole("button", { name: "Show answer (Space)" })).toBeVisible();
    await page.getByRole("button", { name: "Show answer (Space)" }).click();

    // One-shot retry interception for the SECOND review POST. The first
    // route.fetch() writes the review_logs row and advances card 2; the
    // second hits UNIQUE(card_id, review) → the RPC's ON CONFLICT … DO
    // NOTHING path → conflicted: true. The UI sees only the second response.
    // Without this, the React `submitting` guard at StudySessionPage.tsx:111
    // prevents a true double-fire.
    await page.route("**/api/study/review", async (route) => {
      await route.fetch();
      const second = await route.fetch();
      await route.fulfill({ response: second });
      await page.unroute("**/api/study/review");
    });

    // Rate the second card; the intercepted retry should report conflicted: true.
    await page.getByRole("button", { name: /3\.\s*Good/ }).click();

    // Total stays at 1 because card 2's conflicted response is the React
    // state-machine branch under test. The /api/study/next request after
    // a conflicted reply still returns null/done because card 2 was actually
    // advanced server-side by the first internal fetch.
    await expect(page.getByText(/Reviewed 1 cards/i)).toBeVisible();
    await expect(page.getByText("Good: 1")).toBeVisible();
    await expect(page.getByText("Good: 2")).toHaveCount(0);
  });
});
