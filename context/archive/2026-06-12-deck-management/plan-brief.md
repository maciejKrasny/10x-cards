# Plan Brief: Deck Management

> Quick read before the full plan. ~2 minutes. See `plan.md` for the exhaustive contract.

## What & Why

Ship roadmap slice **S-02 (`deck-management`)**: a logged-in user can list, manually create, edit, and delete cards in their deck — AND organize cards into multiple named decks. The slice closes PRD **FR-005** (manual create / gen-fail fallback), **FR-006** (edit), **FR-007** (delete), **FR-008** (list), and **FR-010** (named decks — un-parked from "nice-to-have" by user decision during planning).

Without this slice, every card lives in one unnamed pile, US-01's acceptance criteria around editing/deleting/manual-add are unmet, and there is no recovery path when AI generation fails.

## Starting Point

- **F-01 done**: `public.cards(id, user_id, front, back, created_at)` exists with RLS gating on `auth.uid() = user_id`.
- **S-01 done**: `/dashboard` mounts `PasteToGenerate.tsx`; `POST /api/cards/generate` validates with Zod, calls OpenRouter, bulk-inserts cards. No deck context anywhere.
- **No `/decks` route**, no `decks` table, no shadcn `alert-dialog` primitive yet, no `@radix-ui/react-alert-dialog` dep.
- **`PROTECTED_ROUTES = ["/dashboard"]`** in middleware.

## Desired End State

- `public.decks(id, user_id, name, created_at)` exists with four RLS policies. `public.cards.deck_id NOT NULL` references it (`ON DELETE CASCADE`). Every existing S-01 card is in a per-user auto-created "My Deck".
- `/decks` lists user's decks with card counts; inline create, inline rename, delete-with-AlertDialog-confirm warning about N cascading cards.
- `/decks/[id]` lists that deck's cards newest-first (cap 500); inline create at top, inline edit per row, delete-with-confirm per row.
- `/dashboard` has a deck dropdown above the textarea (defaults to `sessionStorage.lastUsedDeckId`, else newest deck). On success, navigates to `/decks/{deckId}?since=<iso>`; the deck-detail page reads `since` to render an `"N new cards added"` banner and `NEW` badges. The in-place "Latest batch" rendering is gone.
- All decks/cards routes return **401** for anonymous, **404** for cross-user — RLS-enforced, with defence-in-depth `.eq('user_id', user.id)` on mutations.

## Key Decisions Made

| Decision                            | Choice                                                                                                | Why                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-010 multi-deck scope             | **Un-park and ship in S-02** alongside FR-005/6/7/8 — one unified slice                               | User decision mid-planning; avoids a S-02-then-redo path; ships the deck data model once.                                                           |
| Edit UX                             | **Inline-in-list** (one row at a time)                                                                | Lower friction than a separate edit screen; matches the dashboard's island-first pattern.                                                           |
| Delete UX                           | **AlertDialog confirm**, no undo, hard delete                                                         | Matches PRD FR-007 "delete"; soft-delete is YAGNI for MVP volume; cards cascade via FK.                                                             |
| Manual create UX                    | **Inline "+ Add" form** at top of list (decks page & deck-detail page)                                | Single primary action per page, no modal noise; FR-005 fallback path is one click.                                                                  |
| Listing                             | **Single fetch, newest-first, cap 500**                                                               | No pagination UI complexity; 500-row banner if hit (parked feature signal).                                                                         |
| Backfill of existing cards          | **Migration creates "My Deck" per user with cards**, lazy-creates for new users via dashboard POST    | One transactional migration; lazy-create avoids Supabase auth-schema triggers (new mechanism the project lacks).                                    |
| Deck-ownership check on card writes | **Mandatory `SELECT id FROM decks WHERE id=:deck_id` (RLS-scoped) before insert**                     | RLS on cards INSERT only validates `user_id`, not `deck_id` — without this, an attacker with a valid session could insert into another user's deck. |
| Card-count in deck list             | **LEFT JOIN + GROUP BY in one query**, two-query fallback acceptable                                  | One round-trip preferred; fallback noted because Supabase JS foreign-table count syntax can be awkward.                                             |
| Post-generate UX                    | **Full navigation to `/decks/[id]?since=<iso>`**, no SPA routing                                      | Tiny implementation; the deck-detail page is the canonical "see your cards" view.                                                                   |
| Schema scope                        | **Minimum**: `id, user_id, name, created_at` only — no color/description/icon, no `updated_at`        | YAGNI; trivial follow-up migrations when use cases appear.                                                                                          |
| API shape                           | **Nested under `/api/decks/[id]/cards`** for list+create, **flat `/api/cards/[id]`** for PATCH/DELETE | Nested expresses deck-scoping; flat avoids redundant deck_id in URLs for single-card mutations.                                                     |

## Scope

**In:** `decks` table + RLS + migration backfill, decks REST CRUD (5 endpoints), deck-scoped cards REST CRUD (2 routes), per-card PATCH/DELETE, `deck_id` requirement on `/api/cards/generate`, `/decks` list page, `/decks/[id]` detail page, dashboard dropdown + lazy-create + post-success navigation, shadcn `alert-dialog` primitive + new runtime dep.

**Out:** spaced-repetition session (S-03), search/tags/sort UI, bulk operations, move-card-between-decks, deck color/description/icon, `updated_at` on cards, undo affordance, Supabase auth trigger for lazy-create, automated test runner, Sentry/observability, password reset/OAuth (S-04).

## Architecture / Approach

Five phases sequenced by data dependency:

1. **Schema baseline** — one transactional migration creates `decks` + RLS, adds `cards.deck_id` (nullable), backfills "My Deck" per user, locks NOT NULL, indexes. Extends RLS isolation test for the new column; adds a `rls_decks_isolation.sql` test. Hosted push.
2. **REST API** — Zod schemas (`DeckBodySchema`, `CardBodySchema`), three new endpoint files (`/api/decks/index.ts`, `/api/decks/[id].ts`, `/api/decks/[id]/cards.ts`), one new flat file (`/api/cards/[id].ts`), and `/api/cards/generate.ts` extended to require `deck_id` with ownership check. After this phase, the paste flow is _intentionally_ broken in the UI (Phase 5 fixes).
3. **`/decks` list page** — install `@radix-ui/react-alert-dialog`, add shadcn `alert-dialog` primitive, new page + React island (`DeckListPage`, `AddDeckForm`, `DeckRow`, `DeleteDeckDialog`), add `/decks` to `PROTECTED_ROUTES`.
4. **`/decks/[id]` detail page** — new page + island (`DeckDetailPage`, `NewCardsBanner`, `CardRow`, `AddCardForm`, `DeleteCardDialog`); reads `?since=<iso>` for the new-cards highlight.
5. **Dashboard rewire** — `PasteToGenerate.tsx` gains the deck dropdown (defaulting via `sessionStorage.lastUsedDeckId`), lazy-creates "My Deck" if zero decks, removes "Latest batch" rendering, navigates to `/decks/[id]?since=<iso>` on success.

**Sequencing constraint**: the slice ships as one atomic deploy. The migration makes `cards.deck_id NOT NULL` and the generate route demands it; phase boundaries are for incremental implementation only — between Phases 1 and 5, the paste flow is broken by design.

## Phases at a Glance

1. **Schema baseline** — 1 migration + 1 new RLS test + 2 npm script entries + 1 RLS-test update + hosted push.
2. **REST API** — 5 new route files + 2 new schema modules + `generate.ts` extended.
3. **`/decks` list** — 1 new page + 1 new shadcn primitive + 1 new dep + 4 new React components + 1-line middleware change.
4. **`/decks/[id]` detail** — 1 new page + 5 new React components.
5. **Dashboard integration** — `PasteToGenerate.tsx` rewired + small `dashboard.astro` polish.

## Prerequisites

- F-01 + S-01 both `done` (verified — both in `context/archive/`).
- Local Supabase stack running (Docker), hosted project `adtjatwwrarnbsbiexul.supabase.co` reachable, `HOSTED_DB_URL` exportable from dashboard for linked tests.
- Node v22.14.0 active (`nvm use`).
- No new env vars / secrets required for this slice (the `lessons.md` production-secret-rollout rule does NOT apply — Progress has no production-secret checkbox).

## Estimated Effort

5 phases. Phase 1 is the longest single hop (migration + backfill + tests + hosted push). Phases 3–4 are React-heavy and share the AlertDialog primitive added in Phase 3. Phase 5 is small but ships the atomic integration that makes the slice usable. Expect each phase to gate on its Manual Verification list before the next starts.

## Open Risks

- **FR-010 was parked in the PRD as nice-to-have**; un-parking it here means the roadmap S-02 outcome and the PRD's FR-010 status both need post-ship updates. Flagged for `/10x-archive` to surface.
- **Foreign-table count aggregation** in Supabase JS for `GET /api/decks`'s `card_count` field. Two-query fallback acceptable if the API shape proves awkward.
- **Lazy-create race**: two simultaneous fresh-account dashboard tabs could both POST "My Deck". Acceptable for MVP (rename or delete the duplicate); a `(user_id, name)` unique constraint is deferred.
- **Stale `sessionStorage.lastUsedDeckId`**: handled by mount-time dropdown validation; a delete-in-tab-B / paste-in-tab-A race surfaces a 404 at submit time with an English error toast.

## Success Criteria

- All 5 phases' Automated Verification checklists pass (`npm run lint`, `npx astro check`, `npm run build`, Phase 1's RLS tests against local + hosted).
- All 5 phases' Manual Verification checklists pass.
- End-to-end smoke flow (Phase 5, steps 1–12) passes against the deployed Worker.
- No regression of NFR-2 (pasted text leaves no operator-accessible trace): `rg console\.` in `src/pages/api/cards/`, `src/pages/api/decks/`, `src/lib/llm/`, `src/components/cards/PasteToGenerate.tsx` shows no logging of `text` or LLM I/O.
- Cross-user 404 isolation verified at the API layer (Phase 2 manual step 2.11) and at the UI layer (Phase 4 manual step 4.6).
