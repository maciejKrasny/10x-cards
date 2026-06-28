# E2E coverage for SR review session integrity — Plan Brief

> Full plan: `context/changes/testing-e2e-sr-session-integrity/plan.md`

## What & Why

Add a narrow E2E suite that protects the React state-machine slice of `test-plan.md` Risk #4 (SR session integrity) — specifically the three behaviors that only the browser can observe. The integration + contract layer the test plan also prescribes for Risk #4 is intentionally deferred to a sibling `/10x-tdd` change so each test layer stays at the layer it actually proves.

## Starting Point

Playwright is already installed and authenticated (`playwright.config.ts`, `playwright/tests/auth.setup.ts` writes `storageState` for `test@test.pl`), and `playwright/tests/seed.spec.ts` demonstrates the role-locator + per-test-cleanup pattern. The SR session itself ships at `/study/[deckId]` (`src/components/study/StudySessionPage.tsx`) but has zero browser-level coverage today. `cards.due` defaults to `now()`, so freshly-created cards are immediately due — no service-role helper needed.

## Desired End State

Three new specs in `playwright/tests/` each pass against `npm run dev`, each tied by provenance comment to Risk #4, each survives a deliberate-break check, and each cleans up its own deck via `afterEach`. `npm run test:e2e` runs the suite locally. CI wiring is intentionally not added — a follow-up change owns that, mirroring how the unit/integration layer was introduced locally before being lifted to CI.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Scope vs test-plan §3 | E2E-only narrow slice; defer integration + contract to sibling `/10x-tdd` | Each test layer should sit at the layer that actually catches its risk — promoting integration risks to E2E violates `test-plan.md` §1 principle #1. | Plan |
| Scenarios covered | Happy path + conflicted-tick + REVIEW_CONFLICT recovery | The 3 React state-machine branches integration tests can't reach; matches `/10x-e2e`'s 1–3-tests/phase budget. | Plan |
| Test-data setup | API-driven (`POST /api/decks`, `POST /api/decks/:id/cards`) via authenticated `page.request` | Real auth, real RLS, real DB; no FSRS-state backdating needed because cards default to `due = now()`. | Plan |
| Cleanup | `DELETE /api/decks/:id` in `afterEach` (cards cascade) | Exercises real delete path; Playwright runs `afterEach` even on red so failures don't leak state. | Plan |
| Conflicted-tick simulation | `page.route()` with two `route.fetch()` calls forwarding the same request to the real server | Drives the RPC's actual `ON CONFLICT (card_id, review)` path; the React `submitting` guard makes a real double-click impossible. | Plan |
| REVIEW_CONFLICT recovery simulation | `page.route()` once with synthetic 409 + correct error envelope | Precise control over the failure timing; the retry then hits the real server to prove the recovery worked. | Plan |
| Phase shape | 2 phases: fixtures + smoke / two harder specs | Helpers land green first; harder specs build on them; commit-per-phase per `/10x-e2e` ritual. | Plan |
| CI wiring | Local-only; defer to follow-up | Keeps this change focused on the test layer; CI E2E needs browsers + secrets that are a separate concern. | Plan |

## Scope

**In scope:**
- `playwright/tests/study-fixtures.ts` (helper module)
- `playwright/tests/study-session-happy-path.spec.ts`
- `playwright/tests/study-conflicted-tick.spec.ts`
- `playwright/tests/study-review-conflict-recovery.spec.ts`
- (no `package.json` changes — `test:e2e` script already present)
- Deliberate-break verification per spec

**Out of scope:**
- Integration test for `/api/study/review` failure injection (sibling `/10x-tdd` change)
- ts-fsrs wrapper contract test (sibling `/10x-tdd` change)
- Next-due query correctness E2E (integration-layer concern)
- Keyboard-flow spec (handler is trivial; click path covers same state transitions)
- CI wiring (`.github/workflows/ci.yml` edits, browsers, GH secrets)
- Vision / visual-diff testing (excluded by `test-plan.md` §7)
- Service-role Supabase test helper (not needed; cards default to due)

## Architecture / Approach

```
Each spec:
  beforeEach → createStudyDeck(page.request, name, pairs)   ← real auth + API
  body:
    page.goto(/study/<deckId>)
    drive UI via getByRole locators
    [P2 specs only] page.route('**/api/study/review', ...) for one POST
    assert browser-observable outcomes (counters, error alert, request bodies)
  afterEach → deleteStudyDeck(page.request, deckId)         ← real DELETE
```

Real boundaries: auth, routing, the entire app under `npm run dev`, the Supabase DB. The only mocks are the per-spec `page.route()` interceptions of `/api/study/review` in P2 — and even those forward to the real server in the conflicted-tick case.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fixtures + happy-path smoke | `study-fixtures.ts`, happy-path spec, `npm run test:e2e` | Helpers' contract doesn't match what the specs need → P2 stalls |
| 2. Conflicted-tick + REVIEW_CONFLICT recovery | Two `page.route()`-based specs | `route.fetch()` twice-forward pattern produces a flaky test if the server's response timing varies |

**Prerequisites:** Playwright already installed (✓), `test@test.pl` user exists (✓), the SR feature exists and is runnable (`src/components/study/StudySessionPage.tsx` ✓).

**Estimated effort:** ~1 session across 2 phases; ~150 lines of new test code total.

## Open Risks & Assumptions

- The synthetic-409 spec assumes the API error envelope stays `{ ok: false, error: { code, message } }` (the project-wide shape in `src/lib/api/errors.ts`). If that contract shifts under this spec's feet, the spec exercises a path the real server can't produce.
- The `route.fetch()` twice-forward pattern in the conflicted-tick spec depends on the real RPC actually returning `conflicted: true` on the second call. If the RPC's `ON CONFLICT` semantics change, the spec would silently start exercising a different branch — the deliberate-break check catches this at runtime but not at code-review time.
- The provenance comments in each spec are the only mechanism tying these specs to test-plan Risk #4. A future refactor that renames or removes the test plan would orphan the link.

## Success Criteria (Summary)

- Three new specs in `playwright/tests/` pass against `npm run dev`.
- Each spec goes red when its named deliberate break is applied; each returns to green when the break is reverted.
- A full local run leaves no test data behind in the `test@test.pl` account.
