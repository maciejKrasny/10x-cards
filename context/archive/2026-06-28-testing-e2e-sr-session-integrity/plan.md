# E2E coverage for SR review session integrity — Implementation Plan

## Overview

Add a narrow, risk-tied E2E suite that protects the React state-machine slice of Risk #4 (SR review session integrity) — the slice that only the browser can observe. Cover three scenarios: a happy-path session smoke test, the UI honoring `conflicted: true` on a replayed POST (no double counter tick), and the UI recovering from a server `REVIEW_CONFLICT` (409) by clearing `pendingReviewAt` and re-prompting.

The plan deliberately stops at the browser-level slice. The integration-layer failure-injection test for the review-write path, the ts-fsrs wrapper contract test, and the next-due query correctness — all required by `context/foundation/test-plan.md` §3 Phase 3 for full Risk #4 coverage — are out of scope here and tracked as a sibling `/10x-tdd` change.

## Current State Analysis

- **Rendered session UI**: `src/pages/study/[deckId].astro` mounts `src/components/study/StudySessionPage.tsx` as a client-hydrated React component (`client:load`). The component owns the entire session state machine (`phase`, `card`, `counters`, `pendingReviewAt`) and drives `/api/study/next` once + `/api/study/review` per rating.
- **Idempotency anchor lives client-side**: `StudySessionPage.tsx:112-113` captures `review_at` once and holds it in `pendingReviewAt` across retries. The same `review_at` on a retry trips the DB-level `UNIQUE(card_id, review)` on `review_logs`; the RPC returns `{ card, conflicted }` (shape introduced by `supabase/migrations/20260617192636_record_review_return_conflicted.sql:63-66` — the original migration's RPC returned only the card row), and the UI skips the counter increment (`StudySessionPage.tsx:143-152`).
- **`REVIEW_CONFLICT` (server 409)**: `src/lib/study/schemas.ts:18-24` enforces a ±60s window on `review_at` server-side. When the API returns code `REVIEW_CONFLICT`, the UI clears `pendingReviewAt` (`StudySessionPage.tsx:125-127`) so the next click captures a fresh timestamp.
- **Cards are immediately due**: `supabase/migrations/20260613201643_fsrs_state_and_review_logs.sql:20` defaults `cards.due` to `now()`. Newly created cards via `POST /api/decks/:id/cards` (`src/pages/api/decks/[id]/cards.ts:56-113`) are picked up immediately by `getNextDueCard` (`src/lib/study/service.ts:95-118`). **No service-role helper needed for our scenarios.**
- **Playwright already in place**: `playwright.config.ts` defines a `setup` project (`playwright/tests/auth.setup.ts` writes `playwright/.auth/user.json`) plus a `chromium` project that depends on it. A `webServer` block boots `npm run dev`. A seed spec at `playwright/tests/seed.spec.ts` demonstrates the `getByRole` + per-test unique-name + inline cleanup pattern. The test user is `test@test.pl` / `test123`.
- **E2E rules**: encoded in `AGENTS.md` under "Playwright testing" — role-based locators, no `waitForTimeout`, per-test isolation, cleanup. The two `/10x-e2e` quality levers (seed + rules) are already present; this plan reuses them as-is.
- **No existing study-route specs**: `playwright/tests/seed.spec.ts` only covers deck-create persistence. Nothing under `playwright/tests/` touches `/study/[deckId]`.

## Desired End State

After this plan:

- `playwright/tests/study-session-happy-path.spec.ts`, `playwright/tests/study-conflicted-tick.spec.ts`, and `playwright/tests/study-review-conflict-recovery.spec.ts` all pass against `npm run dev`, each authored from `playwright/tests/seed.spec.ts` patterns and each tied by a provenance comment to test-plan Risk #4.
- Each spec carries a verified deliberate-break: inverting the production code path it protects makes the spec go red.
- `playwright/tests/study-fixtures.ts` exposes `createStudyDeck` and `deleteStudyDeck` helpers (authenticated `APIRequestContext` calls to `/api/decks` and `/api/decks/:id/cards`). Specs use these in `beforeEach`/`afterEach`; no test leaks DB state.
- `npm run test:e2e` runs the suite locally via Playwright (script already defined in `package.json`; no edit needed).
- CI wiring for E2E is intentionally NOT added in this change — deferred to a follow-up.

Verification: running `npm run test:e2e` against `npm run dev` reports 4 passing specs (the 3 new ones plus `seed.spec.ts`); inspecting `/decks` as `test@test.pl` after a full run shows no leftover test decks.

### Key Discoveries:

- `cards.due` defaults to `now()` — newly created cards are immediately due (`supabase/migrations/20260613201643_fsrs_state_and_review_logs.sql:20`). API-driven setup needs no FSRS column manipulation for our 3 scenarios.
- The React `submitting` guard (`StudySessionPage.tsx:111`) blocks double-clicks at the UI layer — a real concurrent retry only happens when the *network* retries, which is what `page.route()` lets us simulate cleanly.
- The `next` field of the review response is what advances the UI; the server re-runs `getNextDueCard` after every review (`src/lib/study/service.ts:158`). For the conflicted-tick scenario, the second forwarded request still returns a `next` card — the test asserts on the counter, not on which card shows next.
- `playwright.config.ts:9-15` runs only `*.spec.ts` files as tests; `study-fixtures.ts` (no `.spec`) won't be picked up by Playwright's test discovery.
- `DELETE /api/decks/:id` (`src/pages/api/decks/[id].ts:61-98`) is RLS-scoped and cascades to cards via FK; sufficient for `afterEach` cleanup.

## What We're NOT Doing

- **No integration test for the review-write failure path.** The test plan calls for integration coverage with failure injection (DB error mid-RPC); that's a separate `/10x-tdd` change against `src/pages/api/study/review.ts`.
- **No ts-fsrs wrapper contract test.** Belongs in the same sibling `/10x-tdd` change, with the oracle taken from ts-fsrs library docs — not from `src/lib/study/service.ts`.
- **No next-due query correctness E2E.** Browser-level can only assert "the API returned *a* card"; whether it's the *right* next-due card is an integration assertion against `getNextDueCard`.
- **No keyboard-flow spec.** Space/1–4 handlers in `StudySessionPage.tsx:169-190` are simple and exercised by the happy-path click flow's identical state transitions.
- **No CI wiring.** No `.github/workflows/ci.yml` edits, no Playwright browsers in CI, no new GH secrets. A follow-up change owns that — mirrors how `test-plan.md` §3 Phase 1 introduced unit tests locally first.
- **No vision / visual-diff layer.** Excluded by `test-plan.md` §7.
- **No service-role Supabase helper.** Not needed for any of the 3 scenarios since fresh cards are already due.
- **No load testing.** Not in Risk #4's scope.

## Implementation Approach

Two phases, each ending in one Conventional-Commits commit per `/10x-e2e`'s ritual:

1. **Fixtures + smoke** lands the test-data helpers and proves the happy-path flow works end-to-end. The harder scenarios in P2 depend on these helpers, so landing them green first means P2 can focus entirely on the `page.route()` interception logic.
2. **Conflicted-tick + 409 recovery** uses two `page.route()` techniques: one that *replays* a captured request to the real server (driving the RPC's `ON CONFLICT` path) and one that *synthesizes* a 409 response (driving the React error-recovery branch).

Both phases follow `/10x-e2e`'s PLAN→GENERATE→REVIEW→VERIFY loop, with a deliberate-break check per spec before commit.

## Critical Implementation Details

- **Same-`review_at` retry simulation**: the conflicted-tick spec uses `page.route('**/api/study/review', async (route) => { const res1 = await route.fetch(); const res2 = await route.fetch(); await route.fulfill({ response: res2 }); })` (one-shot, then unroute). The first `route.fetch()` writes the `review_logs` row and advances the card; the second hits `UNIQUE(card_id, review)` and the RPC's `ON CONFLICT … DO NOTHING` returns `conflicted: true`. The UI sees the second response. Without this approach, the React `submitting` guard prevents a true double-fire.
- **Synthetic 409 must match the API's real error shape**: `src/lib/api/errors.ts` defines the envelope. The recovery spec's `route.fulfill` must use `status: 409` and body `{ ok: false, error: { code: 'REVIEW_CONFLICT', message: '…' } }` — any drift means the spec doesn't actually exercise the React branch it claims to. The spec includes a short comment pointing at `errors.ts` so future contributors keep them aligned.

## Phase 1: Test fixtures + happy-path smoke

### Overview

Land authenticated API-driven test fixtures (`createStudyDeck` / `deleteStudyDeck`) and one happy-path smoke spec that exercises the full session flow (login is already handled by the `setup` project's `storageState`). The `npm run test:e2e` script already exists in `package.json` — no `package.json` edit in this phase.

### Changes Required:

#### 1. Test fixtures helper

**File**: `playwright/tests/study-fixtures.ts`

**Intent**: Provide two small helpers that specs call in `beforeEach`/`afterEach` to set up and tear down deck+cards via the real authenticated app API (real auth, real RLS, real DB — matching the /10x-e2e "internal boundaries stay real" rule). Uses Playwright's `APIRequestContext` (`page.request`) which inherits the auth cookies from `storageState`.

**Contract**:
- `createStudyDeck(request: APIRequestContext, name: string, pairs: Array<{ front: string; back: string }>): Promise<{ deckId: string }>` — POSTs to `/api/decks`, captures the `deck.id`, then POSTs each pair to `/api/decks/:id/cards`. Throws on any non-`ok: true` response with the error code in the message.
- `deleteStudyDeck(request: APIRequestContext, deckId: string): Promise<void>` — DELETE `/api/decks/:id`. Swallows `DECK_NOT_FOUND` (idempotent cleanup) and throws on any other failure.
- File name lacks `.spec.ts` so `playwright.config.ts`'s `testMatch: /.*\.spec\.ts/` does not treat it as a test file.

#### 2. Happy-path smoke spec

**File**: `playwright/tests/study-session-happy-path.spec.ts`

**Intent**: Anchor spec proving login + session flow + counter ticks + summary work end-to-end. Tied to test-plan Risk #4 ("SR review session loses today's progress mid-session…"). One test per file per `/10x-e2e`.

**Contract**:
- `test.describe('SR review session happy path (Risk #4)', …)` with a provenance comment linking to `context/foundation/test-plan.md` §2 Risk #4 and citing `seed.spec.ts` as the pattern source.
- `beforeEach`: `createStudyDeck(page.request, \`E2E SR happy ${Date.now()}\`, [<2 pairs>])` → `deckId`.
- `afterEach`: `deleteStudyDeck(page.request, deckId)`.
- Steps (each prefixed by a comment naming the user-visible step):
  1. `await page.goto(\`/study/${deckId}\`)`.
  2. Reveal the back: click `getByRole('button', { name: 'Show answer (Space)' })` (or the Space-key handler — pick click for stability).
  3. Click `getByRole('button', { name: /3\.\s*Good/ })`.
  4. Reveal + rate the second card the same way.
  5. Wait for the summary card via `await expect(page.getByText(/Reviewed 2 cards/i)).toBeVisible()`; assert `getByText('Good: 2')` is visible. No `page.waitForTimeout`.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e -- playwright/tests/study-session-happy-path.spec.ts` exits 0 against a running `npm run dev`
- Lint passes: `npm run lint`
- Deliberate-break: comment out the `setCounters(...)` block at `src/components/study/StudySessionPage.tsx:144-151` → spec goes red on the `Good: 2` assertion → revert the break

#### Manual Verification:

- Run the spec headed (`npx playwright test playwright/tests/study-session-happy-path.spec.ts --headed`) and confirm the UI behaves as the spec asserts (reveal works, ratings tick, summary renders the expected counts)
- After the run, sign in as `test@test.pl` and confirm the test deck does not appear at `/decks`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Conflicted-tick + REVIEW_CONFLICT recovery

### Overview

Add the two browser-level specs that exercise the React state-machine branches the happy-path spec can't reach: the `conflicted: true` counter-skip and the `REVIEW_CONFLICT` (409) error recovery. Both rely on Phase 1's fixtures.

### Changes Required:

#### 1. Conflicted-tick spec

**File**: `playwright/tests/study-conflicted-tick.spec.ts`

**Intent**: Prove the React UI does NOT double-tick the counter when the server reports `conflicted: true` — the browser-level half of Risk #4's idempotency property.

**Contract**:
- One `test.describe('SR review write — conflicted: true skips counter tick (Risk #4)', …)` with a provenance comment.
- `beforeEach` / `afterEach` use the Phase 1 helpers; deck has TWO cards. The spec must assert both that the counter *can* tick (positive) and that a conflicted response *doesn't* tick again (negative); a one-card deck would force an indirect "absence-proves-guard" assertion that is fragile.
- Body:
  1. `page.goto(\`/study/${deckId}\`)`, reveal the first card.
  2. Click `getByRole('button', { name: /3\.\s*Good/ })` — first card rated normally; wait for the second card's front to render so we know the POST settled and counter has ticked to `Good: 1` internally.
  3. Reveal the second card.
  4. Install one-shot `page.route('**/api/study/review', handler)` where `handler` calls `await route.fetch()` *twice* (first writes the new `review_logs` row + advances card 2, second hits `UNIQUE(card_id, review)` → RPC's `ON CONFLICT … DO NOTHING` → `conflicted: true`) and fulfils with the second response, then immediately `await page.unroute('**/api/study/review')`.
  5. Click `getByRole('button', { name: /3\.\s*Good/ })` on the second card.
  6. Wait for the summary via `await expect(page.getByText(/Reviewed 1 cards/i)).toBeVisible()` — total stays at 1 because the conflicted response on card 2 is the React state-machine branch under test.
  7. Assert `getByText('Good: 1')` is visible AND `await expect(page.getByText('Good: 2')).toHaveCount(0)`. Two-card deck ordering is by `due ASC, id ASC` (`src/lib/study/service.ts:111-112`) and both cards have `due = now()`; the spec must not assert WHICH card surfaces first since the tiebreak is a non-deterministic UUID.

#### 2. REVIEW_CONFLICT recovery spec

**File**: `playwright/tests/study-review-conflict-recovery.spec.ts`

**Intent**: Prove the React UI surfaces a user-visible error AND recovers (clears `pendingReviewAt`, re-prompts on next click) when the server returns `REVIEW_CONFLICT` (HTTP 409) — the browser-level half of Risk #4's stale-timestamp handling.

**Contract**:
- `test.describe('SR review write — REVIEW_CONFLICT recovery (Risk #4)', …)` with a provenance comment.
- `beforeEach` / `afterEach` use Phase 1 helpers; deck has one card.
- Body:
  1. `page.goto(\`/study/${deckId}\`)`, reveal.
  2. Install one-shot `page.route('**/api/study/review', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'REVIEW_CONFLICT', message: 'stale review_at' } }) }))`; unroute after one fulfilment.
  3. Capture the request bodies sent over `/api/study/review` via `page.on('request', …)` into an array (or use `page.waitForRequest` twice in sequence) so the spec can compare `review_at` values across the failed and succeeding submits.
  4. Click `getByRole('button', { name: /3\.\s*Good/ })`. Assert the error alert is visible: `getByText('Network hiccup. Please try again.')` (the mapped message from `StudySessionPage.tsx:56`).
  5. Click the same rating again. Assert the summary or next card renders (success path). Assert the second `review_at` differs from the first (proves `pendingReviewAt` was cleared).

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e -- playwright/tests/study-conflicted-tick.spec.ts` exits 0 against `npm run dev`
- `npm run test:e2e -- playwright/tests/study-review-conflict-recovery.spec.ts` exits 0
- Lint passes: `npm run lint`
- Deliberate-break (conflicted-tick): remove the `if (!body.conflicted)` guard at `src/components/study/StudySessionPage.tsx:143` (always tick) → counter on card 2 jumps to `Good: 2` → spec goes red on the `getByText('Good: 2').toHaveCount(0)` assertion → revert
- Deliberate-break (recovery): comment out `setPendingReviewAt(null)` at `src/components/study/StudySessionPage.tsx:126` → the retried POST carries the same `review_at` → spec's "second review_at differs" assertion goes red → revert

#### Manual Verification:

- Eyeball both specs against the five `/10x-e2e` anti-patterns: no hallucinated assertion, no brittle selector (role-only), no shared state across tests, no `waitForTimeout`, every test has its own `afterEach` cleanup
- Run both specs headed (`--headed`) and confirm the error alert renders as expected when the synthetic 409 fires
- After both specs run, sign in as `test@test.pl` and confirm no leftover test decks at `/decks`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before this phase's commit.

---

## Testing Strategy

### Unit Tests:

- Not applicable in this change. This is a testing change; production code is read-only.

### Integration Tests:

- Out of scope here. Integration coverage of `src/pages/api/study/review.ts` (failure injection on the RPC) is deferred to a sibling `/10x-tdd` change per `test-plan.md` §3 Phase 3.

### Manual Testing Steps:

1. After each phase's specs land green, run `npm run dev` + the phase's specs via `npm run test:e2e -- playwright/tests/<spec>.spec.ts --headed` and watch the flow execute.
2. Verify `/decks` is clean for `test@test.pl` after each run.
3. Sanity-check the deliberate breaks listed under each phase's Automated Verification by performing the inversion and re-running the spec; revert immediately.

## Performance Considerations

- Each spec creates a small deck (1–2 cards) and tears it down in `afterEach`. Test runtime stays under a few seconds per spec; the dev server is reused (`reuseExistingServer: !process.env.CI`).
- Specs run sequentially by default in Playwright's chromium project; parallelism is not required for 3 specs and would force a per-test storageState which the current config doesn't provide.

## Migration Notes

- No data migration. No schema changes. No new environment variables (no production secrets — `test-plan.md` lesson on Progress checkboxes for prod secrets does not apply here).
- The `test:e2e` npm script is additive; existing scripts unchanged.

## References

- Change identity: `context/changes/testing-e2e-sr-session-integrity/change.md`
- Test plan: `context/foundation/test-plan.md` §2 Risk #4, §3 Phase 3, §7 (deliberate exclusions)
- Lessons: `context/foundation/lessons.md` (none of the current entries apply to this change — no new prod env vars, no lodash)
- Pattern source for specs: `playwright/tests/seed.spec.ts`
- E2E rules: `AGENTS.md` § "Playwright testing"
- Auth setup: `playwright/tests/auth.setup.ts` (sets `storageState` for `test@test.pl`)
- Production code under observation:
  - `src/components/study/StudySessionPage.tsx` — React state machine
  - `src/pages/api/study/review.ts` — review-write endpoint
  - `src/lib/study/schemas.ts` — `withinReviewWindow` ±60s window
  - `src/lib/study/service.ts` — `applyRating`, `getNextDueCard`
  - `supabase/migrations/20260613201643_fsrs_state_and_review_logs.sql` — `review_logs` schema + initial `record_review` RPC
  - `supabase/migrations/20260617192636_record_review_return_conflicted.sql` — RPC return shape changed to `{ card, conflicted }`; the spec's premise depends on this migration

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test fixtures + happy-path smoke

#### Automated

- [x] 1.1 `npm run test:e2e -- playwright/tests/study-session-happy-path.spec.ts` exits 0 against a running `npm run dev` — bdf2b22
- [x] 1.2 Lint passes: `npm run lint` — bdf2b22
- [x] 1.3 Deliberate-break: comment out the `setCounters(...)` block at `src/components/study/StudySessionPage.tsx:144-151` → spec goes red on the `Good: 2` assertion → revert the break — bdf2b22

#### Manual

- [x] 1.4 Run the spec headed (`npx playwright test playwright/tests/study-session-happy-path.spec.ts --headed`) and confirm the UI behaves as the spec asserts (reveal works, ratings tick, summary renders the expected counts) — f15436a
- [x] 1.5 After the run, sign in as `test@test.pl` and confirm the test deck does not appear at `/decks` — f15436a

### Phase 2: Conflicted-tick + REVIEW_CONFLICT recovery

#### Automated

- [x] 2.1 `npm run test:e2e -- playwright/tests/study-conflicted-tick.spec.ts` exits 0 against `npm run dev` — f15436a
- [x] 2.2 `npm run test:e2e -- playwright/tests/study-review-conflict-recovery.spec.ts` exits 0 — f15436a
- [x] 2.3 Lint passes: `npm run lint` — f15436a
- [x] 2.4 Deliberate-break (conflicted-tick): remove the `if (!body.conflicted)` guard at `src/components/study/StudySessionPage.tsx:143` (always tick) → counter on card 2 jumps to `Good: 2` → spec goes red on the `getByText('Good: 2').toHaveCount(0)` assertion → revert — f15436a
- [x] 2.5 Deliberate-break (recovery): comment out `setPendingReviewAt(null)` at `src/components/study/StudySessionPage.tsx:126` → the retried POST carries the same `review_at` → spec's "second review_at differs" assertion goes red → revert — f15436a

#### Manual

- [x] 2.6 Eyeball both specs against the five `/10x-e2e` anti-patterns: no hallucinated assertion, no brittle selector (role-only), no shared state across tests, no `waitForTimeout`, every test has its own `afterEach` cleanup — f15436a
- [x] 2.7 Run both specs headed (`--headed`) and confirm the error alert renders as expected when the synthetic 409 fires — f15436a
- [x] 2.8 After both specs run, sign in as `test@test.pl` and confirm no leftover test decks at `/decks` — f15436a
