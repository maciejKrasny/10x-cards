<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deck Management — list, edit, delete, and manually create cards

- **Plan**: context/changes/deck-management/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-06-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Defence-in-depth user_id filter missing on deck-ownership reads

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[id]/cards.ts:28, :84; src/pages/api/cards/generate.ts:40
- **Detail**: Three deck-lookup queries use `.select(...).eq("id", deck_id).maybeSingle()` and rely solely on RLS to scope rows. Rest of the codebase (mutations on cards/decks tables) layers explicit `.eq("user_id", user.id)` on top of RLS as defence-in-depth. Current behaviour is correct (RLS holds), but a future policy change or service-role mistake could expose cross-user reads. Adding the filter keeps the codebase pattern consistent.
- **Fix**: Append `.eq("user_id", user.id)` to the three deck-lookup queries.
  - Strength: Matches the explicit-filter pattern on mutations; removes residual risk if RLS is ever weakened.
  - Tradeoff: Minor — one extra clause per site.
  - Confidence: HIGH — identical pattern used elsewhere in this repo.
  - Blind spot: None significant.
- **Decision**: FIXED — applied to all three sites; lint clean.

### F2 — Minor plan-prose drift in DeckListPage empty-state copy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/decks/DeckListPage.tsx:154
- **Detail**: Plan said `AddDeckForm` renders "below" the deck list. Implementation renders it above (matching the rest of the inline-create UX), and the empty-state copy reads "Create your first deck above." UX correct; plan prose was stale.
- **Fix**: Update plan.md Phase 3 prose to "above" at lines 366 and 413.
- **Decision**: FIXED — plan.md updated.

### F3 — PATCH on cards could theoretically desync user_id vs deck_id

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/cards/[id].ts:38-44
- **Detail**: Card-update relies on RLS + user_id filter but doesn't re-verify that the card's deck still belongs to the user. Real-world exploit blocked by RLS.
- **Fix**: No change recommended.
- **Decision**: SKIPPED.

### F4 — sessionStorage access in PasteToGenerate is SSR-fragile

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/cards/PasteToGenerate.tsx:76
- **Detail**: Direct `window.sessionStorage` reads in `loadDecks`. Component is mounted with `client:load` so SSR never executes the path. Would break if the island were switched to `client:idle` with SSR.
- **Fix**: No change; revisit if hydration strategy changes.
- **Decision**: SKIPPED.

### F5 — Defensive empty-array branch on LLM response is unreachable

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/cards/generate.ts:59
- **Detail**: Schema enforces `min(1)` cards, so the runtime check for empty array can't fire. Harmless belt-and-braces against future schema drift.
- **Fix**: No change.
- **Decision**: SKIPPED.

### F6 — [id].astro uses empty-string fallback instead of redirect

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: src/pages/decks/[id].astro
- **Detail**: Plan called for `Astro.redirect("/decks")` when `params.id` is missing; implementation uses `?? ""` because the eslint plugin crashed on the redirect form. Behaviour identical at runtime — Astro routes won't match without an id, so the fallback is unreachable.
- **Fix**: No change.
- **Decision**: SKIPPED.
