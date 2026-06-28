// study-review-conflict-recovery.spec.ts
//
// Risk anchor: context/foundation/test-plan.md §2 Risk #4 — "SR review session
// loses today's progress mid-session, persists a stale review…". This spec
// covers the browser-level half of Risk #4's stale-timestamp handling: when
// the server returns REVIEW_CONFLICT (HTTP 409), the UI must surface an error
// AND clear pendingReviewAt so the next click sends a fresh review_at.
//
// Pattern source: playwright/tests/seed.spec.ts (role-based locators, unique
// test data per run, inline cleanup). The synthetic 409 body matches the
// envelope defined in src/lib/api/errors.ts; if errors.ts drifts, this spec
// stops exercising the React error-recovery branch it claims to.

import { test, expect } from "@playwright/test";
import { createStudyDeck, deleteStudyDeck } from "./study-fixtures";

test.describe("SR review write — REVIEW_CONFLICT recovery (Risk #4)", () => {
  let deckId: string;

  test.beforeEach(async ({ page }) => {
    const result = await createStudyDeck(page.request, `E2E SR recovery ${Date.now()}`, [
      { front: "recovery-front-1", back: "recovery-back-1" },
    ]);
    deckId = result.deckId;
  });

  test.afterEach(async ({ page }) => {
    await deleteStudyDeck(page.request, deckId);
  });

  test("synthetic 409 surfaces the error and the retry sends a fresh review_at", async ({ page }) => {
    // Collect every review_at the UI sends so we can compare the failed
    // submit's timestamp against the succeeding retry's.
    const reviewAts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/study/review")) {
        const body = req.postDataJSON() as { review_at: string };
        reviewAts.push(body.review_at);
      }
    });

    // Open the session and reveal the single card.
    await page.goto(`/study/${deckId}`);
    await page.getByRole("button", { name: "Show answer (Space)" }).click();

    // One-shot synthetic 409. Body shape must match src/lib/api/errors.ts;
    // any drift means the spec stops exercising the REVIEW_CONFLICT branch.
    await page.route("**/api/study/review", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "REVIEW_CONFLICT", message: "stale review_at" } }),
      });
      await page.unroute("**/api/study/review");
    });

    // First click — the synthetic 409 fires; the UI maps REVIEW_CONFLICT to
    // "Network hiccup. Please try again." (StudySessionPage.tsx:56) and the
    // rating buttons re-enable for the retry.
    await page.getByRole("button", { name: /3\.\s*Good/ }).click();
    await expect(page.getByText("Network hiccup. Please try again.")).toBeVisible();

    // Second click — interceptor is gone, real route handles it, summary renders.
    await page.getByRole("button", { name: /3\.\s*Good/ }).click();
    await expect(page.getByText(/Reviewed 1 cards/i)).toBeVisible();

    // Two POSTs went out (the failed one + the successful retry); pendingReviewAt
    // was cleared on the 409, so the retry MUST carry a different review_at.
    expect(reviewAts).toHaveLength(2);
    expect(reviewAts[0]).not.toBe(reviewAts[1]);
  });
});
