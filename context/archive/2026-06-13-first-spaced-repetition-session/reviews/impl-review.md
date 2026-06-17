<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: First Spaced-Repetition Session

- **Plan**: context/changes/first-spaced-repetition-session/plan.md
- **Scope**: All 5 Phases
- **Date**: 2026-06-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — DTO re-declaration breaks shared-types contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/study/StudySessionPage.tsx:8-26
- **Detail**: Component re-declares `Rating`, `IntervalPreview`, `StudyCardView` locally. Plan §Phase 2 #2 created `src/lib/study/types.ts` explicitly so the UI consumes those DTOs without duplicating them. Today the structures match by accident; the next API-shape change will silently diverge.
- **Fix**: Import the three types from `@/lib/study/types` and delete the local declarations.
- **Decision**: FIXED

### F2 — applyRating discards rpc result; replay can double-tick counters

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/study/service.ts:144-150
- **Detail**: Plan §Phase 1 #1 specifies `record_review` returns the canonical post-op card row (newly advanced OR unchanged due to ON CONFLICT). Service destructures only `{ error }` and discards the row, so the route can't tell whether the rpc actually advanced the card or hit conflict. Card-state idempotency is preserved (rpc handles it), but the UI counter contract in `StudySessionPage.tsx:128-134` increments on every 2xx — an explicit replay or stale tab ticks counters twice for one logical review.
- **Fix A ⭐ Recommended**: Capture the rpc data and return a `conflicted: boolean` on `ReviewResult` so the route/UI can skip the counter tick on replay.
  - Strength: Closes the only known idempotency leak end-to-end; uses the rpc's already-returned data.
  - Tradeoff: Touches `ReviewResult` shape (already drifted in F7); bundle this with that fix.
  - Confidence: HIGH — the rpc was designed for this very signal.
  - Blind spot: Need to verify UI counter-tick is the only user-visible side effect.
- **Fix B**: Document the replay-counter quirk as accepted MVP behavior.
  - Strength: Zero code change; matches "no test runner, smoke by hand" posture.
  - Tradeoff: Quirk lives forever in StudySessionPage; future contributors will rediscover it.
  - Confidence: MEDIUM — depends whether anyone reviews summary counts at MVP.
  - Blind spot: Could surface in a multi-tab user complaint.
- **Decision**: FIXED via Fix A (new migration `20260617192636_record_review_return_conflicted.sql`, `ReviewResult.conflicted`, route forwards, UI skips counter on conflicted)

### F3 — submit() lacks phase=="submitting" early guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/study/StudySessionPage.tsx:117-118
- **Detail**: Rating buttons are disabled via `disabled={submitting}`, but the keydown handler dispatches `submit()` based on `phase==="showAnswer"`. A rapid second keypress fired before React rerenders to "submitting" re-enters submit() with the same `pendingReviewAt` and a different rating. The rpc dedupes by `(card_id, review_at)` so card-state stays consistent, but the second click still triggers the counter tick (see F2).
- **Fix**: Add `if (phase === "submitting") return;` at the top of submit().
- **Decision**: FIXED

### F4 — getNextDueCard relies on RLS, lacks explicit user_id predicate

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/study/service.ts:95-118
- **Detail**: Query filters by `deck_id` + `due<=now` and orders by `(due, id)` but has no `.eq("user_id", userId)`. RLS provides the user scope. The composite index `idx_cards_user_due` is `(user_id, due)`, so without an explicit user_id predicate the planner may not pick it. Plan §Desired End State #1 names that index as the access path.
- **Fix**: Add `.eq("user_id", userId)` to the select chain in `getNextDueCard`.
- **Decision**: SKIPPED

### F5 — REVIEW_CONFLICT toast uses wrong copy

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/study/StudySessionPage.tsx:62
- **Detail**: REVIEW_CONFLICT case shows "Network hiccup. Please try again." — confusing because the server actually returned "Review timestamp is out of range" (errors.ts:32). The user has no idea their device clock is off.
- **Fix**: Use "Review timestamp out of range. Please try again." for REVIEW_CONFLICT and keep the generic "Network hiccup" copy for true network/5xx errors.
- **Decision**: SKIPPED

### F6 — Route-level card-ownership pre-check moved into service

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/study/review.ts:39-62
- **Detail**: Plan §Phase 3 #3 calls for a pre-rpc card-ownership check in the route. Implementation does the check inside `applyRating` (service.ts:132-133) instead. Same outcome (404 CARD_NOT_FOUND) but layering drifts from the plan's stated "route validates inputs/auth, service performs work".
- **Fix**: Leave as-is OR (if pedantic about layering) lift the ownership check back into the route per plan.
- **Decision**: SKIPPED

### F7 — ReviewResult.summary? field missing from types

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/study/types.ts:29-31
- **Detail**: Plan §Phase 2 #2 contract: `ReviewResult` is `{ next: StudyCardView | null; summary?: { reviewed: number } }`. Actual type omits `summary?`. No consumer reads it today; bundle with F2 if implementing the conflicted/no-op signal.
- **Fix**: Add `summary?: { reviewed: number; conflicted?: boolean }` (or similar) when threading the rpc result through.
- **Decision**: SKIPPED

### F8 — fsrsToCardPatch named/typed differently than plan's fsrsToCardUpdate

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/study/service.ts:58
- **Detail**: Plan §Phase 2 #4 contract names this `fsrsToCardUpdate(card) → TablesUpdate<"cards">`. Actual export is `fsrsToCardPatch` returning a custom `CardPatch` type that emits "" for null `last_review` (the rpc's plpgsql body nullifs it). Functional path is sound; naming + return type drifted.
- **Fix**: Rename to `fsrsToCardUpdate` OR document the naming choice next to the function (the empty-string sentinel for null is a non-obvious detail worth a comment).
- **Decision**: SKIPPED
