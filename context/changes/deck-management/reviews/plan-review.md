<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deck Management

- **Plan**: `context/changes/deck-management/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-12
- **Verdict**: REVISE
- **Findings**: 2 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | PASS |
| Plan Completeness | FAIL |

## Grounding

9/9 paths ✓, 4/4 symbols ✓, brief↔plan ✓

## Findings

### F1 — Phase 2 contract omits `deck` field that Phase 4 depends on

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §6 vs. Phase 4 §2
- **Detail**: Phase 2 §6 says `GET /api/decks/[id]/cards` returns `{ ok: true, cards: [...] }`. Phase 4 §2 (the deck-detail island) needs the deck name to render the page heading and explicitly notes: "Simpler path: extend the GET response to include `deck: { id, name }` alongside `cards`. Update Phase 2's contract accordingly. (Plan note: I'm folding this back into Phase 2's response shape — `{ ok: true, deck: {...}, cards: [...] }`.)" — but Phase 2's text was never actually updated. An implementer reading Phase 2 in isolation will ship the smaller shape; Phase 4 then hits a missing field.
- **Fix ⭐**: Update Phase 2 §6 inline.
  - Change the GET return shape to `{ ok: true, deck: { id, name }, cards: [...] }`.
  - Add to the SQL: the deck-ownership SELECT (already required for the 404 check) doubles as the source of `deck.name`.
  - Remove the parenthetical "I'm folding this back" note from Phase 4.
  - Strength: Removes a real implementation gotcha; single edit; the deck-ownership SELECT is already mandatory for the 404 check.
  - Tradeoff: None — pure clarification.
  - Confidence: HIGH — the responsibility split between phases is clear once the contract is consistent.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix ⭐ applied — Phase 2 §6 response shape updated; Phase 4 §2 fold-back note removed)

### F2 — Progress section is missing 3 success-criteria entries

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Phase 4 Progress blocks
- **Detail**: Mechanical Progress↔SC contract violations:
  - Phase 3 SC has "Validation" bullet (line 395); Progress 3.x has no matching entry.
  - Phase 4 SC has "Validation" (line 488) and "Server error" (line 489) bullets; Progress 4.x has neither.
  Per `references/progress-format.md`, /10x-implement parses Progress as the canonical execution gate; missing entries mean the implementer never ticks those boxes, then declares "phase complete" without verifying validation / failure UI.
- **Fix**: Add three checkboxes:
  - Phase 3 Progress: `- [ ] 3.12 Empty/over-length name validation handled gracefully`
  - Phase 4 Progress: `- [ ] 4.14 Empty front/back disables Save in edit mode`
  - Phase 4 Progress: `- [ ] 4.15 Server error during edit shows English toast; row reverts to display mode`
- **Decision**: FIXED (three checkboxes added: 3.12, 4.14, 4.15)

### F3 — Error envelope pattern proliferates across 6 routes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §3–7 (all five new routes + generate.ts update)
- **Detail**: `src/pages/api/cards/generate.ts` already declares its own ErrorCode enum, ERROR_MESSAGES, STATUS_BY_CODE, errorResponse() (lines 10–44). Phase 2 adds DECK_NOT_FOUND, CARD_NOT_FOUND, DB_QUERY_FAILED to most of the five new routes — each redeclaring the four-pattern boilerplate. Six near-identical copies of "error code → status + message" maps is the textbook pattern-proliferation case AGENTS.md cautions about ("Don't add abstractions beyond what the task requires" — but the flip side is also true: six is past the threshold where duplication starts to drift).
- **Fix A ⭐ Recommended**: Extract a shared `src/lib/api/errors.ts`
  - Single `ErrorCode` union, ERROR_MESSAGES, STATUS_BY_CODE, `errorResponse()`.
  - Refactor `generate.ts` to import from it (small touch); five new routes import directly.
  - Strength: Single source of truth for status codes + English copy. New codes (DECK_NOT_FOUND, CARD_NOT_FOUND) land in one place. Future routes inherit the pattern.
  - Tradeoff: One new file (~40 LOC), one extra import per route. The enum grows a union of every code used anywhere — slightly wider than each route needs.
  - Confidence: HIGH — generate.ts's existing shape transplants cleanly.
  - Blind spot: None significant; the pattern is well-established in TS codebases.
- **Fix B**: Accept inline duplication in each route
  - Strength: Each route is self-contained; per-route enums document the exact contract that route honors. No new abstraction.
  - Tradeoff: Six copies of essentially the same boilerplate; English error copy could drift between routes; adding a new code means editing N files.
  - Confidence: MEDIUM — works fine in the short term; pain grows with route count.
  - Blind spot: How many more routes the project will add post-MVP.
- **Decision**: FIXED (Fix A applied — new §3 "Shared API error helpers" creates `src/lib/api/errors.ts`; §4 migrates generate.ts; §§5–8 reference the shared helper; Phase 2 Overview updated; cross-ref §6→§7 updated; Progress 2.14 added)

### F4 — Testing Strategy copy slightly misleading

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Testing Strategy → Automated (line 557)
- **Detail**: Says "`npm run db:test:rls` (extended for `deck_id`) and `npm run db:test:rls:decks` against both local and hosted DBs." Technically `db:test:rls` runs `rls_cards_isolation.sql` (the cards test, updated for the new `deck_id NOT NULL` constraint) — not "extended to cover decks". The decks test is separate. Minor copy clarity; not load-bearing.
- **Fix**: Rephrase to: "`npm run db:test:rls` runs the cards isolation test (updated for `deck_id` NOT NULL); `npm run db:test:rls:decks` runs the new decks isolation test."
- **Decision**: FIXED (Testing Strategy → Automated rephrased)
