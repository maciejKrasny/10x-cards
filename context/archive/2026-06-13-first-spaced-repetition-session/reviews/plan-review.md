<!-- PLAN-REVIEW-REPORT -->

# Plan Review: First Spaced-Repetition Session (S-03)

- **Plan**: `context/changes/first-spaced-repetition-session/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-13
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 1 critical, 4 warnings, 2 observations

## Verdicts

| Dimension             | Verdict        |
| --------------------- | -------------- |
| End-State Alignment   | WARNING → PASS |
| Lean Execution        | PASS           |
| Architectural Fitness | WARNING → PASS |
| Blind Spots           | WARNING → PASS |
| Plan Completeness     | WARNING → PASS |

## Grounding

5/5 paths ✓ (`src/lib/llm/openrouter.ts`, `src/lib/cards/schemas.ts`, `src/lib/utils.ts`, `src/components/cards/PasteToGenerate.tsx`, `src/db/database.types.ts`). Symbol check found `TablesRow<>` referenced in plan but only `Tables<>`/`TablesInsert<>`/`TablesUpdate<>` exported — flagged as F6. Brief↔plan consistent.

## Findings

### F1 — `applyRating` service lacks the deck context it needs to return the next card

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 service contract ↔ Phase 3 POST /api/study/review
- **Detail**: Service signature `applyRating(supabase, userId, input: ReviewInput)` lacks `deck_id`, but per-deck routing requires next-card lookup to be deck-scoped.
- **Fix A ⭐ Recommended**: Derive deck_id from card row inside the service.
  - Strength: Zero API surface change; service already reads card row; no client needs to know its own deck_id.
  - Tradeoff: Deck scoping implicit in card_id rather than named field.
  - Confidence: HIGH — single round-trip to same row.
  - Blind spot: None significant.
- **Fix B**: Add deck_id to ReviewRequestSchema + validate against card.deck_id.
  - Strength: Explicit contract; refuses mismatched pairs.
  - Tradeoff: Client round-trip + new failure mode (CARD_DECK_MISMATCH).
  - Confidence: MEDIUM.
  - Blind spot: Whether future cross-deck route would want it.
- **Decision**: FIXED (Fix A) — Phase 2 `applyRating` contract updated to read `card.deck_id` from the row and use it to scope `getNextDueCard`.

### F2 — End State promises "next-due relative time" but Phase 4 hardcodes "Come back tomorrow"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State #5 ↔ Phase 4 component contract
- **Detail**: End State promises a precise next-due relative time; Phase 4 contract explicitly defers to a hardcoded "Come back tomorrow" prompt. Contradiction left to the implementer.
- **Fix**: Drop "next-due relative time" from End State #5; align manual check 4.8 to verify the "Come back tomorrow" copy.
- **Decision**: FIXED — End State #5 reworded; manual check 4.8 updated.

### F3 — Two-step write (log INSERT + card UPDATE) isn't transactional

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 `applyRating` contract
- **Detail**: Two separate Supabase JS client calls (insert log, update card) without a transaction. Partial failure leaves state divergent under Guardrails-2.
- **Fix A ⭐ Recommended**: Postgres function called via `supabase.rpc`.
  - Strength: True transactional atomicity; both ops commit or neither; ON CONFLICT branch handled at DB layer.
  - Tradeoff: New rpc pattern in codebase; bit more SQL.
  - Confidence: HIGH — standard PG pattern.
  - Blind spot: Where scheduler.next runs — answer: in TS, pass computed patch as jsonb arg.
- **Fix B**: Document ordering + on-conflict-recompute and accept the gap.
  - Strength: No new pattern.
  - Tradeoff: Guardrails-2 risk under partial Supabase failures.
  - Confidence: MEDIUM.
  - Blind spot: Failure frequency in prod.
- **Decision**: FIXED (Fix A) — migration adds `record_review(p_card_id, p_rating, p_review_at, p_card_patch jsonb) returns jsonb` with `SECURITY INVOKER`; Phase 2 `applyRating` now calls `supabase.rpc('record_review', ...)`; manual verification 1.5 updated to confirm function presence.

### F4 — `{ ok: false } + HTTP 200` for NO_DUE_CARDS breaks the existing envelope convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 error codes
- **Detail**: Existing convention: `ok: false` only with 4xx/5xx. Plan adds NO_DUE_CARDS at 200 — produces `Response.ok === true` + `body.ok === false`, forcing UI to handle 3 branches instead of 2.
- **Fix A ⭐ Recommended**: Return `{ ok: true, card: StudyCardView | null }`; remove NO_DUE_CARDS code.
  - Strength: Mirrors POST endpoint's `ReviewResult.next` shape; keeps convention clean.
  - Tradeoff: One nullable field on GET response.
  - Confidence: HIGH.
  - Blind spot: None.
- **Fix B**: HTTP 404 for NO_DUE_CARDS.
  - Strength: Stays inside convention.
  - Tradeoff: Conflates "not found" with "empty".
  - Confidence: MEDIUM.
  - Blind spot: 404-as-warning surfaces.
- **Decision**: FIXED (Fix A) — Phase 3 contract returns `{ ok: true, card: view }`; NO_DUE_CARDS removed from `ErrorCode`/`ERROR_MESSAGES`/`STATUS_BY_CODE`; manual checks and brief updated.

### F5 — `review_at` regenerated per click defeats DB-level idempotency under retry

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details ↔ Phase 4 component submit handler
- **Detail**: Plan acknowledges the rule ("client retries must send same review timestamp") but Phase 4 generates `review_at = new Date().toISOString()` at submit time. Transient failure → user retry → new timestamp → card advances twice.
- **Fix A ⭐ Recommended**: Component retains `pendingReviewAt` across retries; clears only on acknowledged success.
  - Strength: Stays inside DB-only idempotency decision.
  - Tradeoff: Small state addition; needs one verification step.
  - Confidence: HIGH.
  - Blind spot: Multi-tab — out of MVP scope.
- **Fix B**: Add Idempotency-Key header (reverses question 6 decision).
  - Strength: Cleanest separation; survives clock skew.
  - Tradeoff: Contradicts locked decision; bigger surface.
  - Confidence: MEDIUM.
  - Blind spot: Multi-tab warrant.
- **Decision**: FIXED (Fix A) — Phase 4 submit handler now captures `pendingReviewAt`, retains across network/5xx retries, clears on success or on REVIEW_CONFLICT (window expired, safe to regenerate). Added manual check 4.11 to verify retry idempotency via devtools Offline → Online toggle.

### F6 — Plan references `TablesRow<…>` but generated types only export `Tables<…>`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 service contract
- **Detail**: `src/db/database.types.ts` exports `Tables<>`, `TablesInsert<>`, `TablesUpdate<>` — no `TablesRow<>`. Phase 2 uses `TablesRow<"cards">`.
- **Fix**: Rename `TablesRow<"cards">` to `Tables<"cards">` in Phase 2.
- **Decision**: FIXED — both Phase 1 (codegen description) and Phase 2 (`cardRowToFsrs` signature) renamed.

### F7 — Idempotency smoke uses devtools "Resend" — same body, same timestamp

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 Manual Verification 5.5
- **Detail**: devtools "Resend" replays original payload; tests the ON CONFLICT happy path but not the regenerated-timestamp case.
- **Fix**: Replace 5.5 with a two-part curl check covering same-body replay AND regenerated-timestamp case.
- **Decision**: SKIPPED — F5's component fix + the new manual check 4.11 (Offline → Online toggle, verify same `review_at` in body) already cover the realistic retry case end-to-end. 5.5 retains value as a pure server-side ON CONFLICT smoke.
