# Deck Management Implementation Plan

## Overview

Ship multi-deck card management in a single slice: a new `decks` table + RLS, a backfill that gives every existing S-01 card a home in a per-user "My Deck", four new REST endpoint groups (decks CRUD, deck-scoped cards GET/POST + flat per-card PATCH/DELETE, plus a `deck_id` requirement on `/api/cards/generate`), two new pages (`/decks` list and `/decks/[id]` detail), an updated paste flow on `/dashboard` with a deck dropdown, and a transient "N new cards" highlight on the deck-detail page driven by a `?since=<iso>` query param.

This single slice covers FR-005 (manual create), FR-006 (edit), FR-007 (delete), FR-008 (list), AND FR-010 (named decks) — the last of which was parked as nice-to-have in the PRD but un-parked by user decision during planning. The roadmap's S-02 entry will need its outcome line updated to reflect multi-deck.

## Current State Analysis

- **S-01 (paste-to-AI-cards) is `done`**: `/dashboard` mounts a `PasteToGenerate` React island (`src/components/cards/PasteToGenerate.tsx`) that renders a "Latest batch" read-only list of just-generated cards. The endpoint `src/pages/api/cards/generate.ts` takes `{ text }`, validates with Zod, calls OpenRouter, and bulk-inserts into `public.cards`. No deck context anywhere.
- **F-01 (cards schema) is `done`**: `public.cards(id, user_id, front, back, created_at)` exists with four RLS policies gating on `auth.uid() = user_id` (`supabase/migrations/20260605112924_cards_baseline.sql`). The migration + codegen + RLS-test pattern is established; `npm run db:types` regenerates `src/db/database.types.ts` from the local stack; `supabase/tests/rls_cards_isolation.sql` exists as a worked example for the new decks test.
- **Supabase SSR client is typed**: `src/lib/supabase.ts` returns `SupabaseClient<Database>`; returns `null` when env vars are missing.
- **API auth pattern is established** (`src/pages/api/cards/generate.ts`): JSON-in / JSON-out; per-route `supabase.auth.getUser()` (middleware does not redirect API routes); Zod-validated body; uniform `{ ok: false, error: { code, message } }` error envelope with stable code strings; never logs the request body.
- **shadcn registry**: only `button`, `alert`, `textarea`. `alert-dialog` (used for delete confirms) does not exist yet; `@radix-ui/react-alert-dialog` runtime dep is not installed.
- **Middleware** (`src/middleware.ts:4`): `PROTECTED_ROUTES = ["/dashboard"]`, matched via `startsWith` — so adding `"/decks"` covers both `/decks` and `/decks/[id]`.
- **English UI overrides AGENTS.md Polish convention** (per session memory, set during S-01).
- **No test runner**; CI runs lint + `astro check` + Supabase `db reset` + `db:types` drift-check + build.
- **Hosted Supabase** project: `adtjatwwrarnbsbiexul.supabase.co`; F-01's deploy runbook documents the link + push procedure.

## Desired End State

When the slice is done:

- `public.decks(id, user_id, name, created_at)` exists locally AND on the hosted DB, with RLS enabled and four policies (`select`, `insert`, `update`, `delete`) gating on `user_id = auth.uid()`.
- `public.cards.deck_id uuid not null references public.decks(id) on delete cascade` exists; an index on `(deck_id)` supports the per-deck list query. Every pre-existing card from S-01 is bound to a "My Deck" automatically created for its owner by the same migration.
- A signed-in user at `/decks` sees the list of their decks (name + card count), can create a new deck (inline form at top, name field), rename a deck (inline edit), and delete a deck (AlertDialog confirm explicitly warning that the deck and its N cards will be deleted; cascade DELETE handled by the FK).
- At `/decks/[id]`, the user sees every card in that deck (newest-first, cap 500), with inline create at top, inline edit per row, delete-with-confirm per row.
- At `/dashboard`, a deck dropdown above the textarea lets the user pick the target deck for AI generation. The dropdown defaults to `sessionStorage.lastUsedDeckId` if present and still valid; otherwise to the user's first deck (chronological). If the user has zero decks on first visit, the island POSTs `{ name: "My Deck" }` once to lazy-create.
- After successful generation, the dashboard navigates the browser to `/decks/{selectedDeckId}?since=<requestStartIso>` (no more in-place "Latest batch" rendering); the deck-detail page reads `since`, shows a dismissible banner `"N new cards added"`, and renders a `NEW` badge on rows with `created_at >= since`.
- Anonymous requests to `GET /api/decks`, `POST /api/decks`, `PATCH /api/decks/[id]`, `DELETE /api/decks/[id]`, `GET /api/decks/[id]/cards`, `POST /api/decks/[id]/cards`, `PATCH /api/cards/[id]`, `DELETE /api/cards/[id]`, or `POST /api/cards/generate` all receive HTTP 401 with the established JSON error envelope.
- An authenticated user crafting a `POST /api/decks/<other-user-deck-id>/cards`, `PATCH /api/cards/<other-user-card-id>`, etc., receives HTTP 404 (not 401, not 403 — to avoid leaking existence). RLS guarantees this even without explicit application checks, but every mutation route also includes a defence-in-depth `.eq('user_id', user.id)` predicate.
- `PROTECTED_ROUTES` in `src/middleware.ts` includes `"/decks"`.

### Verification:

- Sign in, navigate to `/decks` → see "My Deck" (auto-created from backfill if you have S-01 cards) plus any newly-created decks.
- Create a deck named "Trial deck"; rename it to "Renamed"; click delete → AlertDialog shows "0 cards"; confirm → it's gone.
- From `/dashboard`, pick a target deck in the dropdown; paste a ~2 000-char text; click generate → after the LLM response, browser navigates to `/decks/<targetId>?since=<iso>`; banner reads "N new cards added"; the first N rows show a NEW badge; dismiss the banner → query param removed from history state; badges still visible until reload.
- At `/decks/<targetId>`, edit a card inline; save; delete a card with the confirm dialog; add a manual card at top; verify they appear/disappear immediately.
- Sign out, retry each API endpoint via curl → 401.
- `npm run db:test:rls` (the cards isolation test, updated for `deck_id NOT NULL`) and the new `npm run db:test:rls:decks` (decks isolation test) both exit 0 against local and hosted DBs.

## What We're NOT Doing

- **No `updated_at` column** on `cards` (user-confirmed defer; trivial follow-up migration when a use case arrives).
- **No deck color, deck description, or deck icon** — schema is `id, user_id, name, created_at` only.
- **No move-card-between-decks UX** — a card stays in the deck it was created in; cross-deck moves are out of scope. (Possible follow-up: add a `deck_id` field to `PATCH /api/cards/[id]`, but the UI doesn't expose it.)
- **No bulk operations** (multi-select delete, bulk-edit) — single-card mutations only.
- **No deck/card search, tagging, or sorting controls** — newest-first only; sort UI is YAGNI for the MVP volume.
- **No soft-delete / archive** for either decks or cards — hard delete throughout, matching PRD FR-007.
- **No spaced-repetition session** — owned by S-03, blocked on this slice.
- **No streaming AI output, no determinate progress bar, no per-card retry** — same posture as S-01.
- **No multi-select edit-multiple-rows-at-once** — only one row is editable at a time per deck.
- **No automated test runner** (vitest / Playwright) — parked at roadmap level; manual verification gates per phase.
- **No password-reset / OAuth / account-deletion** — S-04 territory.
- **No Sentry / structured logging / metrics** — parked at the roadmap level until a production failure forces the issue.

## Implementation Approach

Five phases, sequenced by data dependency. Phase 1 lands the schema and types — the foundation Phases 2-5 inherit. Phase 2 lands all REST endpoints (decks CRUD, deck-scoped cards CRUD, and the `deck_id` requirement on the existing generate route) so the entire HTTP surface is in place before any UI work. Phases 3 and 4 build the two new pages atop those endpoints in dependency order (`/decks` list first because `/decks/[id]` is reached by clicking through it). Phase 5 atomically rewires the dashboard paste flow, completing the slice and re-enabling AI generation against the new schema.

**Sequencing constraint**: Phase 1 makes `cards.deck_id NOT NULL`. Phase 2's update to `/api/cards/generate` makes the route demand `deck_id` in the request body. Phase 5 is the only point where the dashboard sends `deck_id`. Between Phase 1 and Phase 5, the paste flow is broken in the UI by design — the slice ships atomically; phase boundaries exist for incremental implementation, not separate deploys.

A new runtime dependency, `@radix-ui/react-alert-dialog`, is introduced in Phase 3. It is the headless primitive shadcn's `alert-dialog` component wraps. No other new runtime deps; `zod` (already a dep) is reused for both decks and cards request validation.

## Critical Implementation Details

- **Migration ordering for `cards.deck_id` not-null backfill**. Adding the column as `NOT NULL` upfront would fail because existing rows have no value. The correct sequence inside one migration file is: (1) `CREATE TABLE decks` + RLS, (2) `ALTER TABLE cards ADD COLUMN deck_id uuid REFERENCES decks(id) ON DELETE CASCADE` (nullable initially), (3) `INSERT INTO decks (user_id, name) SELECT DISTINCT user_id, 'My Deck' FROM cards` (one "My Deck" per user who has cards), (4) `UPDATE cards SET deck_id = (SELECT id FROM decks WHERE decks.user_id = cards.user_id AND decks.name = 'My Deck')`, (5) `ALTER TABLE cards ALTER COLUMN deck_id SET NOT NULL`, (6) `CREATE INDEX idx_cards_deck_id ON cards (deck_id)`. The whole file is one transaction; if any step fails, nothing applies.
- **Deck-ownership check on nested `POST /api/decks/[id]/cards` and on `POST /api/cards/generate`**. RLS gates the cards-insert on `user_id = auth.uid()` but does NOT verify that the supplied `deck_id` belongs to the same user — an attacker with a valid session who guesses or scrapes another user's deck UUID could otherwise create cards in someone else's deck (the RLS check would pass because `user_id` is their own). Mitigation: each route that accepts a `deck_id` must first `SELECT id FROM decks WHERE id = :deck_id` (RLS-scoped to current user). If no row, return `404` (not 403 — to avoid confirming existence to a scanner). Only then proceed to insert.
- **Lazy-create of "My Deck" is client-side from the dashboard, not a Supabase trigger**. When `PasteToGenerate` mounts and `GET /api/decks` returns an empty array, the island POSTs `{ name: "My Deck" }` once. The choice not to add a Supabase trigger on `auth.users` insert is deliberate (per user decision in planning): triggers live in the `auth` schema, are harder to roll back, and add a new mechanism the project doesn't currently use. The trade-off is one extra round-trip on first-visit dashboard load; users with cards from S-01 already have "My Deck" from the migration backfill and never hit this path.
- **Card count in deck-list response**. The `/decks` page shows a per-deck card count alongside the name. The list endpoint resolves it via a LEFT JOIN + GROUP BY in one query (rather than a separate count per deck) so the deck-list payload is one round-trip. RLS still applies — only the calling user's decks (and their cards) participate in the count.
- **Privacy carry-over from S-01 (NFR-2)**. `/api/cards/generate` already enforces "pasted text leaves no operator-accessible trace." This slice adds a `deck_id` body field. The deck_id is fine to log (it's a UUID, not user content), but the `text` discipline is unchanged — no `console.*` on the body, no error envelope echoing it. Re-verify in Phase 2 manual verification.

---

## Phase 1: Schema baseline — `decks` table + `cards.deck_id` + backfill + RLS test

### Overview

Land the schema baseline for multi-deck. One migration file does all of it: create `decks`, add `cards.deck_id` (nullable), backfill, set NOT NULL, index. Extend the RLS isolation test to cover the new table. Regenerate types. Push to hosted DB.

### Changes Required:

#### 1. New migration: `decks_baseline` + `cards.deck_id` backfill

**File**: `supabase/migrations/<timestamp>_decks_baseline.sql` (CLI-generated timestamp; create via `npx supabase migration new decks_baseline`).

**Intent**: Land the decks table + RLS policies, add the FK column on cards, backfill existing cards into a per-user "My Deck", and lock the column as NOT NULL — all in one transactional migration.

**Contract**:
- `CREATE TABLE public.decks (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null check (char_length(name) between 1 and 100), created_at timestamptz not null default now())`.
- Index `idx_decks_user_id` on `(user_id)`.
- `ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY` + four policies (`decks_select_own`, `decks_insert_own`, `decks_update_own`, `decks_delete_own`), each `TO authenticated`, gating on `user_id = auth.uid()`. Mirror the cards-policy shape in `20260605112924_cards_baseline.sql:15-30`.
- `ALTER TABLE public.cards ADD COLUMN deck_id uuid REFERENCES public.decks(id) ON DELETE CASCADE` (nullable at this point).
- Backfill block — non-obvious because of the user-scoped join shape:

```sql
insert into public.decks (user_id, name)
  select distinct user_id, 'My Deck' from public.cards
  on conflict do nothing;

update public.cards
  set deck_id = (select id from public.decks
                  where decks.user_id = cards.user_id
                    and decks.name = 'My Deck'
                  limit 1)
  where deck_id is null;
```

- `ALTER TABLE public.cards ALTER COLUMN deck_id SET NOT NULL`.
- `CREATE INDEX idx_cards_deck_id ON public.cards (deck_id)`.

#### 2. Apply locally + regen types

**Run**: `npx supabase db reset` then `npm run db:types`.

**Intent**: Prove the migration applies cleanly to a fresh DB and `src/db/database.types.ts` reflects the new shape (decks table, cards.deck_id column).

**Contract**: `npx supabase db reset` exits 0; `src/db/database.types.ts` now exports `Tables<'decks'>`, `TablesInsert<'decks'>`, `TablesUpdate<'decks'>`, and `Tables<'cards'>` includes `deck_id`.

#### 3. Extend the RLS isolation test

**File**: `supabase/tests/rls_decks_isolation.sql` (new, mirrors `rls_cards_isolation.sql`).

**Intent**: Encode the Guardrails-1 invariant for decks: user B never sees user A's decks. Same two-synthetic-user pattern as the cards test.

**Contract**: Three transaction blocks following the existing file's idiom (`auth.users` upsert → `set local request.jwt.claims` → insert → assert in a separate transaction with the other user's claims that `SELECT count(*) FROM public.decks WHERE user_id = '<other>'` returns 0). Final cleanup block deletes the synthetic decks rows and synthetic auth.users rows so the script is idempotent across runs and leaves no trace on the hosted DB.

#### 4. Add npm wrapper for the decks RLS test

**File**: `package.json` (extend the existing `scripts` block).

**Intent**: One-command run for the decks RLS test, mirroring the existing cards test commands.

**Contract**: Two new scripts in `package.json`:
- `"db:test:rls:decks": "cat supabase/tests/rls_decks_isolation.sql | docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1"`
- `"db:test:rls:decks:linked": "cat supabase/tests/rls_decks_isolation.sql | docker run --rm -i postgres:17-alpine psql \"${HOSTED_DB_URL:?HOSTED_DB_URL not set; export it from the Supabase dashboard before running}\" -v ON_ERROR_STOP=1"`

#### 5. Push to hosted DB + re-run isolation tests

**Run**: `npx supabase db push`, then `HOSTED_DB_URL=... npm run db:test:rls:linked` and `HOSTED_DB_URL=... npm run db:test:rls:decks:linked`.

**Intent**: Apply the migration to `adtjatwwrarnbsbiexul.supabase.co` and confirm RLS isolation behaves identically against the hosted infra. F-01 Phase 4 documented this pattern in the deploy runbook.

**Contract**: Migration appears in hosted `supabase_migrations.schema_migrations`. `pg_policies` on `decks` returns 4 rows; both isolation tests exit 0 against the hosted DB. The deploy runbook (`context/changes/deployment/runbook.md`) gets a one-line cross-reference to the new test command.

#### 6. Update F-01 RLS test for `deck_id` not-null

**File**: `supabase/tests/rls_cards_isolation.sql`.

**Intent**: The existing test inserts into `public.cards` without a `deck_id` — after Phase 1 that fails because the column is NOT NULL. Fix by inserting a per-test-user deck inside each insert block and using its id.

**Contract**: Each of the two existing insert blocks gets a preceding `INSERT INTO public.decks (user_id, name) VALUES (...) RETURNING id` (captured into a `do $$ ... $$` block variable, then used in the `INSERT INTO public.cards`), or equivalently a `WITH d AS (insert ... returning id) INSERT INTO cards (..., deck_id) SELECT ..., d.id FROM d` CTE. The cleanup block at the end is extended to also delete the synthetic decks rows.

### Success Criteria:

#### Automated Verification:

- New migration file exists at `supabase/migrations/*_decks_baseline.sql`.
- `npx supabase db reset` exits 0.
- `npm run db:types` exits 0; `src/db/database.types.ts` now has `decks` and `cards.deck_id`.
- `npm run db:test:rls` (the existing cards test, updated for `deck_id`) exits 0.
- `npm run db:test:rls:decks` exits 0.
- `npm run lint` passes.
- `npx astro check` passes against the regenerated types.
- `npm run build` passes.

#### Manual Verification:

- In Supabase Studio (`http://localhost:54323`), the `decks` table is visible with the four RLS policies; the `cards` table shows the new `deck_id` column and the FK to `decks(id)`.
- Existing S-01-era cards (if any) now have a non-null `deck_id` pointing at a "My Deck" row owned by their user. Verify with: `SELECT c.front, d.name FROM cards c JOIN decks d ON d.id = c.deck_id;`.
- After `npx supabase db push`, the hosted dashboard for `adtjatwwrarnbsbiexul` shows the same schema; hosted policies count = 4 on `decks`.
- Both linked RLS tests pass against hosted.
- The Supabase dashboard's "Authentication" → "Policies" view for `decks` shows all four policies named and scoped correctly.

**Implementation Note**: After Phase 1's automated verification passes, pause for manual confirmation that local Studio shows the schema correctly AND the hosted push succeeded before proceeding to Phase 2. Phase 2 cannot be verified without the schema in place.

---

## Phase 2: REST API — decks CRUD + deck-scoped cards CRUD + generate-route `deck_id`

### Overview

All HTTP surface for the slice lands in one phase. Four new route files (decks list/create, deck rename/delete, deck-scoped cards list/create, per-card update/delete) plus an update to the existing `/api/cards/generate.ts` to require `deck_id`. Two new Zod schema modules (`src/lib/decks/schemas.ts`, `src/lib/cards/schemas.ts`) and one new error-envelope helper module (`src/lib/api/errors.ts`) shared by all six routes — generate.ts is also migrated onto it so the codes/messages/statuses live in one place. After this phase, the paste flow is broken in the UI (Phase 5 wires the dropdown that supplies `deck_id`) but every endpoint is independently exercisable from `curl`.

### Changes Required:

#### 1. Decks request-body schemas

**File**: `src/lib/decks/schemas.ts`

**Intent**: Define the validation schemas the decks routes use, plus the inferred TypeScript types.

**Contract**:
- `DeckBodySchema = z.object({ name: z.string().min(1).max(100) })`.
- Exported type: `DeckBody = z.infer<typeof DeckBodySchema>`.
- Bounds match the `name` CHECK constraint in the migration (`char_length between 1 and 100`).

#### 2. Cards request-body schemas

**File**: `src/lib/cards/schemas.ts`

**Intent**: Define the validation schema for manual create + edit. Reused by `POST /api/decks/[id]/cards` and `PATCH /api/cards/[id]`.

**Contract**:
- `CardBodySchema = z.object({ front: z.string().min(1).max(1000), back: z.string().min(1).max(1000) })`.
- Exported type: `CardBody = z.infer<typeof CardBodySchema>`.
- Bounds match the existing `cards` CHECK constraints.
- Note: this duplicates the bounds in `src/lib/llm/schemas.ts`'s `GeneratedCardSchema`. Intentional: the LLM schema is shipped to OpenRouter as a JSON-schema response format and may evolve differently; the API-input schema is for our HTTP routes. Both must stay aligned with the cards table's CHECK constraints; a comment in each file notes the dependency.

#### 3. Shared API error helpers

**File**: `src/lib/api/errors.ts` (new)

**Intent**: Consolidate the error-envelope plumbing currently inlined in `src/pages/api/cards/generate.ts` (lines 10–44 today) into one module that all six routes import from. Six near-identical copies of `ErrorCode` / `ERROR_MESSAGES` / `STATUS_BY_CODE` / `errorResponse()` is past the threshold where duplication starts to drift; one shared module keeps status codes and English copy aligned across the surface.

**Contract**:
- Exports:
  - `ErrorCode` — union of all codes used across the API: `'INVALID_REQUEST' | 'INPUT_TOO_SHORT' | 'INPUT_TOO_LONG' | 'UNAUTHORIZED' | 'DECK_NOT_FOUND' | 'CARD_NOT_FOUND' | 'LLM_FAILURE' | 'DB_INSERT_FAILED' | 'DB_QUERY_FAILED' | 'DB_UPDATE_FAILED' | 'DB_DELETE_FAILED' | 'SERVER_MISCONFIGURED'`.
  - `ERROR_MESSAGES: Record<ErrorCode, string>` — single source of truth for the English client-visible copy.
  - `STATUS_BY_CODE: Record<ErrorCode, number>` — single source of truth for HTTP status.
  - `errorResponse(code: ErrorCode): Response` — returns `new Response(JSON.stringify({ ok: false, error: { code, message: ERROR_MESSAGES[code] } }), { status: STATUS_BY_CODE[code], headers: { 'Content-Type': 'application/json' } })`. Same shape generate.ts ships today.
- Behaviour: pure module; no I/O, no logging. Codes intentionally cover the union of every code any route emits — slightly wider than each route needs, in exchange for one place to edit when a new code appears.
- Migration of `generate.ts` (covered in §4 below): delete the local `ErrorCode` / `ERROR_MESSAGES` / `STATUS_BY_CODE` / `errorResponse` declarations; replace with `import { errorResponse, type ErrorCode } from '@/lib/api/errors'`. The `classifyZodError` helper (also currently in generate.ts) stays put — it's Zod-specific and reused by the new routes via direct import from generate.ts (or, optionally, lift into the same `errors.ts` if the implementer prefers; either is fine for MVP).

#### 4. Update `/api/cards/generate` for `deck_id`

**File**: `src/pages/api/cards/generate.ts`

**Intent**: Make `deck_id` a required field in the request body; verify the deck belongs to the user before generating; inject `deck_id` into the inserted rows. Also migrate the route to the shared error helpers introduced in §3.

**Contract**:
- Extend `GenerateRequestSchema` in `src/lib/llm/schemas.ts`: add `deck_id: z.string().uuid()`. (Keep `text` field unchanged.)
- After `supabase.auth.getUser()` and before the LLM call: `SELECT id FROM decks WHERE id = :deck_id` (RLS-scoped to current user). If no row, return `errorResponse('DECK_NOT_FOUND')` (the code, status 404, and English message all come from `src/lib/api/errors.ts`).
- When building the rows for bulk insert, include `deck_id: parsed.data.deck_id` alongside `user_id, front, back`.
- Replace the local `ErrorCode` / `ERROR_MESSAGES` / `STATUS_BY_CODE` / `errorResponse` declarations with imports from `@/lib/api/errors`. Behaviour unchanged.
- Logging discipline unchanged from S-01 — `deck_id` is OK to log (UUID, not user content); `text` and LLM I/O remain untouched.

#### 5. Decks list + create endpoint

**File**: `src/pages/api/decks/index.ts`

**Intent**: `GET /api/decks` returns the user's decks (newest-first) WITH a `card_count` per deck; `POST /api/decks` creates a new deck.

**Contract**:
- `export const prerender = false`.
- `GET`: auth via `supabase.auth.getUser()`; query `SELECT id, name, created_at, (SELECT count(*) FROM cards WHERE cards.deck_id = decks.id) AS card_count FROM decks ORDER BY created_at DESC`. RLS scopes both selects to the user. Response: `{ ok: true, decks: Array<{ id, name, created_at, card_count }> }`. (Supabase JS API: use `.select('id, name, created_at, cards(count)')` with the `count` foreign-table aggregation, or fall back to a raw RPC; pick whichever Supabase JS supports cleanly at implementation time. If the foreign-table count syntax is awkward, two-query pattern — list decks then aggregate counts client-side — is an acceptable fallback for MVP volume.)
- `POST`: auth check; parse body via `DeckBodySchema.safeParse`; on validation failure return `errorResponse('INVALID_REQUEST')` (no field-detail leakage — the UI only sends valid inputs); insert `{ user_id, name }`; return `{ ok: true, deck: { id, name, created_at, card_count: 0 } }`.
- Errors use `errorResponse()` from `src/lib/api/errors.ts` (§3). Codes used: `INVALID_REQUEST`, `UNAUTHORIZED`, `DB_INSERT_FAILED` / `DB_QUERY_FAILED`, `SERVER_MISCONFIGURED`.

#### 6. Deck rename + delete endpoint

**File**: `src/pages/api/decks/[id].ts`

**Intent**: `PATCH /api/decks/[id]` renames a deck; `DELETE /api/decks/[id]` deletes a deck (cards cascade via the FK).

**Contract**:
- `export const prerender = false`.
- `PATCH`: auth check; parse `DeckBodySchema`; `.update({ name }).eq('id', id).select('id, name, created_at').single()`. RLS gates ownership; if `.single()` returns no row, return `errorResponse('DECK_NOT_FOUND')`. Defence-in-depth: also include `.eq('user_id', user.id)`. Success response: `{ ok: true, deck: {...} }`.
- `DELETE`: auth check; `.delete().eq('id', id).select('id').single()`. Same 404 handling. Success response: `{ ok: true }`. Cards in the deck disappear via FK cascade — no application-layer iteration.
- Errors use `errorResponse()` from `src/lib/api/errors.ts` (§3). Codes: `INVALID_REQUEST`, `UNAUTHORIZED`, `DECK_NOT_FOUND`, `DB_*_FAILED`, `SERVER_MISCONFIGURED`.

#### 7. Deck-scoped cards list + create endpoint

**File**: `src/pages/api/decks/[id]/cards.ts`

**Intent**: `GET /api/decks/[id]/cards` returns the deck's cards (newest-first, cap 500); `POST /api/decks/[id]/cards` creates a card in that deck (FR-005 manual create path).

**Contract**:
- `export const prerender = false`.
- Both methods: auth check; verify deck ownership by `SELECT id, name FROM decks WHERE id = :id` (RLS-scoped). If no row, return `errorResponse('DECK_NOT_FOUND')`. This is the security-critical check called out in Critical Implementation Details — without it, the route would happily insert cards into another user's deck (RLS on cards INSERT only validates `user_id`, not `deck_id`). The `name` column from this SELECT doubles as the source for the `deck` field returned by `GET` (see below).
- `GET`: `SELECT id, front, back, created_at FROM cards WHERE deck_id = :id ORDER BY created_at DESC LIMIT 500`. Return `{ ok: true, deck: { id, name }, cards: [...] }` — `deck` reuses the row already fetched for the ownership check, so the deck-detail page can render its heading without a second round-trip. The 500 cap is policy not protection — if hit, the UI displays a banner; pagination is parked.
- `POST`: parse `CardBodySchema`; insert `{ user_id, deck_id: id, front, back }`; return `{ ok: true, card: { id, front, back, created_at } }`.
- Errors use `errorResponse()` from `src/lib/api/errors.ts` (§3). Codes: decks-routes set plus `INPUT_TOO_LONG` / `INPUT_TOO_SHORT` distinguished by Zod path/code (uses `classifyZodError` from generate.ts).

#### 8. Per-card update + delete endpoint

**File**: `src/pages/api/cards/[id].ts`

**Intent**: `PATCH /api/cards/[id]` edits a card's front/back; `DELETE /api/cards/[id]` deletes a single card.

**Contract**:
- `export const prerender = false`.
- `PATCH`: auth check; parse `CardBodySchema`; `.update({ front, back }).eq('id', id).select('id, front, back, created_at, deck_id').single()`. If no row, return `errorResponse('CARD_NOT_FOUND')`. Defence-in-depth: `.eq('user_id', user.id)`. Both `front` and `back` are required (full replacement, not partial). Success: `{ ok: true, card: {...} }`.
- `DELETE`: auth check; `.delete().eq('id', id).select('id').single()`. Same 404 handling. Success: `{ ok: true }`.
- Errors use `errorResponse()` from `src/lib/api/errors.ts` (§3). Codes: `INVALID_REQUEST`, `INPUT_TOO_SHORT`, `INPUT_TOO_LONG`, `UNAUTHORIZED`, `CARD_NOT_FOUND`, `DB_*_FAILED`, `SERVER_MISCONFIGURED`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro check` passes — confirms typed Supabase client usage across all five route files.
- `npm run build` passes.
- The CI types-in-sync guardrail (`git diff --exit-code src/db/database.types.ts`) is unaffected — no new migrations in this phase.

#### Manual Verification:

- **Decks list/create**: `curl http://localhost:4321/api/decks` (with auth cookie) → 200 with `{ ok: true, decks: [...] }` including any backfilled "My Deck"; `curl -X POST .../api/decks -H 'Content-Type: application/json' -d '{"name":"Trial"}'` → 200 with the new deck; Studio shows the new row.
- **Decks rename/delete**: `curl -X PATCH .../api/decks/<id> -d '{"name":"Renamed"}'` → 200; `curl -X DELETE .../api/decks/<id>` → 200; verify cascade — cards in the deck are gone in Studio.
- **Deck-scoped cards list/create**: `curl .../api/decks/<id>/cards` → 200 with newest-first cards; `curl -X POST .../api/decks/<id>/cards -d '{"front":"f","back":"b"}'` → 200; Studio confirms the new row with the right `deck_id`.
- **Per-card update/delete**: `curl -X PATCH .../api/cards/<id> -d '{"front":"f2","back":"b2"}'` → 200; `curl -X DELETE .../api/cards/<id>` → 200.
- **Generate route**: `curl -X POST .../api/cards/generate -d '{"text":"...","deck_id":"<valid-deck>"}'` → 200; Studio shows new rows with the correct `deck_id`. `curl -X POST .../api/cards/generate -d '{"text":"..."}'` (no deck_id) → 400 `INVALID_REQUEST`. `curl -X POST .../api/cards/generate -d '{"text":"...","deck_id":"<other-user-deck-uuid>"}'` → 404 `DECK_NOT_FOUND`.
- **Cross-user isolation**: sign in as user A, list user A's decks; sign in as user B in a different browser; `curl .../api/decks/<userA-deck-id>/cards` from B's session → 404. `curl -X PATCH .../api/cards/<userA-card-id>` from B's session → 404.
- **Anonymous**: every endpoint without cookie → 401.
- **Privacy re-check (NFR-2 carry-over)**: `rg -n 'console\.(log|error|warn|info|debug)' src/pages/api/cards/ src/pages/api/decks/ src/lib/llm/` → no logging of paste text, LLM I/O, or any user content; deck names and UUIDs are OK if absolutely necessary (prefer none).

**Implementation Note**: After Phase 2 passes both verifications, pause for sign-off. The paste flow in the UI is intentionally broken at this point (dashboard does not yet send `deck_id`); generate-from-UI testing waits for Phase 5.

---

## Phase 3: `/decks` list page + AlertDialog primitive + deck CRUD UI

### Overview

New `/decks` page mounting a React island that fetches `GET /api/decks` and lets the user create, rename, and delete decks. The delete confirm uses shadcn's `alert-dialog` primitive, which doesn't exist yet — add it (one runtime dep, one component file). Add `/decks` to `PROTECTED_ROUTES`.

### Changes Required:

#### 1. Install `@radix-ui/react-alert-dialog`

**File**: `package.json`

**Intent**: Runtime dep that shadcn's `alert-dialog` component wraps. Standard shadcn pattern.

**Contract**: Add `@radix-ui/react-alert-dialog` to `"dependencies"`; `package-lock.json` updates. No version pin beyond a caret on the current major.

#### 2. Add shadcn `alert-dialog` primitive

**File**: `src/components/ui/alert-dialog.tsx`

**Intent**: Drop in the canonical shadcn `alert-dialog` component so it can be composed where the slice needs confirm dialogs (deck delete in this phase; card delete in Phase 4).

**Contract**: Default-exported components matching the shadcn `alert-dialog` API: `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`. Use the existing project's `cn()` helper from `@/lib/utils` and Tailwind classes consistent with `alert.tsx` / `button.tsx`. Pull the canonical implementation from the shadcn registry; minor adjustments allowed for the `cn()` helper.

#### 3. Decks list page

**File**: `src/pages/decks/index.astro`

**Intent**: Render the standard `Layout` and mount a single React island (`DeckListPage`) hydrated `client:load`. The page itself is structural; all state and fetching live in the island.

**Contract**: Front-matter imports `Layout` and `DeckListPage`; the body renders `<DeckListPage client:load />` inside `<Layout title="Decks">`. Reuse the dashboard's gradient/glass styling shell (`bg-cosmic`, etc.) so the two pages feel like one product. Include a small "← Back to dashboard" link above the heading.

#### 4. Add `/decks` to `PROTECTED_ROUTES`

**File**: `src/middleware.ts`

**Intent**: Anonymous users hitting any `/decks*` URL are redirected to `/auth/signin`, matching the existing dashboard pattern.

**Contract**: Change `PROTECTED_ROUTES = ["/dashboard"]` to `PROTECTED_ROUTES = ["/dashboard", "/decks"]`. `startsWith` matching covers both `/decks` and `/decks/<id>`.

#### 5. Deck list island

**File**: `src/components/decks/DeckListPage.tsx`

**Intent**: Top-level React component that fetches `GET /api/decks` on mount, owns the list state, and composes `AddDeckForm` + per-deck `DeckRow` + `DeleteDeckDialog`. On mutations, it updates local state optimistically and rolls back on error.

**Contract**:
- Local state: `decks: Deck[]`, `status: 'loading' | 'idle' | 'error'`, `errorMessage: string | null`, `editingDeckId: string | null` (only one row in rename mode at a time), `deletingDeck: Deck | null` (the deck about to be confirmed for deletion; null when no dialog open).
- On mount: `fetch('/api/decks')`, on success populate `decks` and set `status='idle'`; on failure show an inline `Alert` "Couldn't load your decks. Reload to retry." (and a Retry button that re-runs the fetch).
- Handlers (each calls the corresponding REST endpoint, then mutates local state):
  - `handleCreate(name)` → POST `/api/decks`; prepend new deck to list on success.
  - `handleRename(id, name)` → PATCH `/api/decks/[id]`; replace in-place on success; clear `editingDeckId`.
  - `handleDelete(id)` → DELETE `/api/decks/[id]`; remove from list on success; clear `deletingDeck`.
- Renders, in order: heading "Your decks", success/error `Alert` (transient), `AddDeckForm` (toggleable), then `decks.map(d => <DeckRow ... />)`. Empty state: "No decks yet. Create your first deck below." (the AddDeckForm CTA is always visible).
- Card-count badge per row: `{deck.card_count} cards` (singular/plural with a small helper).
- Each `DeckRow` is a link wrapper around the deck name (navigates to `/decks/[id]`); rename / delete buttons are siblings that do NOT trigger navigation.
- All UI text is English.

#### 6. Add-deck form

**File**: `src/components/decks/AddDeckForm.tsx`

**Intent**: Inline toggleable form at the top of the deck list: "+ Add deck" button reveals a row with a name input and Submit/Cancel buttons.

**Contract**: Local state `mode: 'collapsed' | 'expanded'` and `name: string`. Collapsed: a single `Button` "+ Add deck". Expanded: an `<input type="text">` (NOT a Textarea — single-line) with `maxLength={100}`, `placeholder="Deck name"`, Submit (disabled when `name.trim().length === 0`) and Cancel. Submit calls a prop `onSubmit(name)` and waits; on resolve, the form returns to collapsed and `name` is cleared. Cancel returns to collapsed without submitting. Enter key submits; Escape cancels. The parent (`DeckListPage`) owns the actual fetch.

#### 7. Deck row with inline rename

**File**: `src/components/decks/DeckRow.tsx`

**Intent**: One row in the deck list. Display mode: deck name (as a link to `/decks/[id]`), card-count badge, Rename and Delete buttons. Edit mode: name input + Save/Cancel.

**Contract**: Props: `deck: { id, name, card_count, created_at }`, `isEditing: boolean`, `onStartEdit: () => void`, `onCancelEdit: () => void`, `onSave: (name: string) => void`, `onDelete: () => void`. The link wrapping the name uses `<a href={`/decks/${deck.id}`}>` — plain Astro/HTML; no client router. The Rename button calls `onStartEdit`; the row's name span swaps to an `<input>` with the same single-line shape as `AddDeckForm` (`maxLength={100}`); Save calls `onSave(name)`; Cancel calls `onCancelEdit`. Delete calls `onDelete` (parent opens the dialog).

#### 8. Delete-deck confirm dialog

**File**: `src/components/decks/DeleteDeckDialog.tsx`

**Intent**: Wraps `AlertDialog` to confirm deck deletion, explicitly warning that cards will cascade.

**Contract**: Props: `deck: { id, name, card_count } | null` (when null, dialog is closed), `onCancel: () => void`, `onConfirm: () => void`. Title: `"Delete deck '${deck.name}'?"`. Description: `"This will permanently delete the deck and its ${deck.card_count} card${plural(deck.card_count)}. This cannot be undone."`. Two buttons in the footer: Cancel (closes dialog) and Delete (destructive variant; calls `onConfirm`).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro check` passes.
- `npm run build` passes.

#### Manual Verification:

- **Logged-in render**: navigate to `/decks` → see the list; "My Deck" appears if the migration backfilled it; AddDeckForm is collapsed at the top.
- **Anonymous gate**: signed-out visit to `/decks` → redirected to `/auth/signin`.
- **Create deck**: click "+ Add deck" → form expands; type "Trial deck" → Submit; row appears at the top; Submit clears the form and re-collapses; card count shows "0 cards".
- **Rename deck**: click Rename on a row → swap to inline input; type new name; Save; row updates in place. Cancel discards.
- **Delete deck (empty)**: Delete on the "Trial deck" → dialog reads "Delete deck 'Trial deck'? This will permanently delete the deck and its 0 cards.". Confirm → row removed.
- **Delete deck (with cards)**: create a card via API/Studio in "My Deck"; refresh `/decks`; Delete on "My Deck" → dialog shows the correct count; confirm → row removed; verify in Studio that the cards cascade-deleted.
- **Validation**: try to submit an empty name (button is disabled). Try to submit > 100 chars (input maxLength caps; server-side also rejects); UI handles gracefully.
- **Server error**: stop the local Astro server mid-mutation; click Delete; an English error toast appears; row remains in the list.
- **Empty state**: delete every deck (cascade-deletes everything); list shows "No decks yet. Create your first deck below." with the form visible.

**Implementation Note**: After Phase 3, decks can be managed but `/decks/[id]` does not exist yet — clicking a deck name 404s. Pause for sign-off and proceed to Phase 4.

---

## Phase 4: `/decks/[id]` detail page — card CRUD UI + `NewCardsBanner`

### Overview

New `/decks/[id]` page mounting a React island that fetches the deck's cards and lets the user inline-create / inline-edit / delete-with-confirm. Reads `?since=` from the URL to render a transient banner and `NEW` badges on freshly-created rows. Reuses the AlertDialog primitive from Phase 3 for the delete confirm.

### Changes Required:

#### 1. Deck detail page

**File**: `src/pages/decks/[id].astro`

**Intent**: Same shape as the decks list page — `Layout` + a single React island. The dynamic `[id]` segment is read in the front-matter and passed to the island as a prop so the island can issue the right fetch on mount.

**Contract**: Read `Astro.params.id` (string) in front-matter; if absent (shouldn't happen with the route shape, but defence), redirect to `/decks`. Pass `<DeckDetailPage deckId={id} client:load />` into the layout. Page title: `"Deck"` (the actual deck name is populated by the island once fetched — no SSR for it to keep the page simple). Include a small "← Back to decks" link.

#### 2. Deck detail island

**File**: `src/components/cards/DeckDetailPage.tsx`

**Intent**: Top-level React component that fetches the deck's cards on mount, owns the list state, composes `NewCardsBanner` + `AddCardForm` + per-card `CardRow` + `DeleteCardDialog`. On mutations, updates local state and rolls back on error.

**Contract**:
- Props: `deckId: string`.
- Local state: `deck: { id, name } | null` (resolved after first fetch), `cards: Card[]`, `status: 'loading' | 'idle' | 'error'`, `errorMessage: string | null`, `editingCardId: string | null`, `deletingCard: Card | null`, `since: string | null` (the `?since=` query param value, captured once on mount), `bannerDismissed: boolean`.
- On mount: read `since` from `window.location.search`; fetch `/api/decks/[deckId]/cards`. The response includes `deck: { id, name }` (see Phase 2 §7), which the heading renders directly — no second round-trip needed.
- Handlers:
  - `handleCreate(front, back)` → POST `/api/decks/[deckId]/cards`; prepend on success.
  - `handleEdit(id, front, back)` → PATCH `/api/cards/[id]`; replace in-place on success; clear `editingCardId`.
  - `handleDelete(id)` → DELETE `/api/cards/[id]`; remove on success; clear `deletingCard`.
- Renders, in order: heading (deck name), "← Back to decks" link, `NewCardsBanner` (if `since && !bannerDismissed && newCount > 0`), `AddCardForm` (toggleable), then `cards.map(c => <CardRow ... />)`. Empty state: "No cards yet. Add one below or paste text on the dashboard." with a link to `/dashboard`.
- The 500-card cap banner: if `cards.length === 500`, render an `Alert` "Showing the 500 most recent cards. Pagination is on the roadmap." above the list.
- All UI text is English.

#### 3. New-cards banner

**File**: `src/components/cards/NewCardsBanner.tsx`

**Intent**: Read `?since=<iso>` from props, compute the count of cards with `created_at >= since`, render `"N new cards added"` in a dismissible `Alert`.

**Contract**: Props: `cards: Card[]`, `since: string | null`, `onDismiss: () => void`. Renders nothing if `since` is null. Otherwise counts `cards.filter(c => c.created_at >= since).length` (string comparison on ISO timestamps is correct). On dismiss, the parent sets `bannerDismissed = true` AND calls `window.history.replaceState(null, '', window.location.pathname)` to drop the query param from the URL. NEW badges on each card (rendered inside `CardRow`) read the same `since` and stay visible until reload (deliberate — the badge is a soft signal, not a state machine).

#### 4. Card row with inline edit + NEW badge

**File**: `src/components/cards/CardRow.tsx`

**Intent**: One row in the card list. Display mode: front + back as plain text, Edit + Delete buttons, optional NEW badge. Edit mode: front Textarea + back Textarea + Save/Cancel.

**Contract**: Props: `card: { id, front, back, created_at }`, `isEditing: boolean`, `isNew: boolean`, `onStartEdit: () => void`, `onCancelEdit: () => void`, `onSave: (front: string, back: string) => void`, `onDelete: () => void`. Display: visually distinct labels for FRONT / BACK (small uppercase tracking), NEW badge if `isNew` (e.g. `bg-emerald-500/20 text-emerald-100 ...` chip). Edit: two `<Textarea>` components with `maxLength={1000}` each, plus Save (disabled when either field is empty or unchanged) and Cancel. Enter does NOT submit (textareas need newlines); a `Save` button is the only commit path. Escape cancels.

#### 5. Add-card form

**File**: `src/components/cards/AddCardForm.tsx`

**Intent**: Inline toggleable form at the top of the deck detail list: "+ Add card" button reveals front/back Textareas + Submit/Cancel.

**Contract**: Local state `mode: 'collapsed' | 'expanded'`, `front: string`, `back: string`. Collapsed: a `Button` "+ Add card". Expanded: two `<Textarea>` with `maxLength={1000}` each (rows=3 each), Submit (disabled when either trims to empty), and Cancel. Submit calls `onSubmit(front, back)`; on resolve, returns to collapsed and clears state. Cancel returns to collapsed.

#### 6. Delete-card confirm dialog

**File**: `src/components/cards/DeleteCardDialog.tsx`

**Intent**: Wraps `AlertDialog` to confirm card deletion.

**Contract**: Props: `card: { id, front } | null` (null = closed), `onCancel: () => void`, `onConfirm: () => void`. Title: `"Delete this card?"`. Description: shows the first ~80 chars of the front as a preview (so the user knows which card they're deleting): `"Front: ${truncate(card.front, 80)}. This cannot be undone."`. Cancel + Delete buttons in the footer (destructive variant on Delete).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro check` passes.
- `npm run build` passes.

#### Manual Verification:

- **Logged-in render**: navigate to `/decks/<id>` (a deck that exists) → heading shows the deck name; cards list renders newest-first; "+ Add card" is visible at top.
- **Anonymous gate**: signed-out visit to `/decks/<id>` → redirected to `/auth/signin`.
- **Wrong deck id**: navigate to `/decks/<other-user-deck-uuid>` → page-level error state ("Couldn't load this deck. It may not exist or belong to you. Back to decks.") because the API returns 404.
- **Add card**: click "+ Add card" → form expands; type front + back; Submit → new card appears at top; form re-collapses.
- **Edit card**: click Edit on a row → fields become editable; modify; Save → row updates with new front/back. Cancel discards.
- **Delete card**: click Delete → dialog reads "Delete this card? Front: ...". Confirm → row removed.
- **Empty deck**: delete every card; list shows "No cards yet. Add one below or paste text on the dashboard."
- **500-cap banner**: if a user has > 500 cards in a deck (manually inserted in Studio for test), the banner appears.
- **`?since=` banner + NEW badges**: navigate to `/decks/<id>?since=<iso-1-hour-ago>` → banner reads "N new cards added" (N = number of cards in deck with `created_at >= since`); each of those rows has a NEW badge. Click dismiss on the banner → banner disappears, URL becomes `/decks/<id>` (no query param), but the badges remain.
- **Validation**: try saving an edit with an empty front → Save is disabled. Same for back.
- **Server error**: stop the Astro server mid-edit; click Save; English error toast appears; row reverts to display mode without persisting.

**Implementation Note**: After Phase 4, deck management is functional end-to-end except the paste flow (still broken because the dashboard does not yet send `deck_id`). Pause for sign-off and proceed to Phase 5.

---

## Phase 5: Dashboard paste-flow integration — deck dropdown, lazy-create, navigate

### Overview

Atomically rewire `PasteToGenerate.tsx`: add a deck dropdown above the textarea, lazy-create "My Deck" on first visit if the user has zero decks, remove the in-place "Latest batch" rendering, and on success navigate to `/decks/{selectedDeckId}?since=<requestStartIso>`. After this phase, the slice is shippable end-to-end.

### Changes Required:

#### 1. PasteToGenerate gains deck dropdown + lazy-create + navigate

**File**: `src/components/cards/PasteToGenerate.tsx`

**Intent**: Pre-flight deck context, target-deck selection, and on-success navigation to the detail page. No more in-place batch list.

**Contract**:
- New local state: `decks: Deck[]`, `selectedDeckId: string | null`, `decksStatus: 'loading' | 'idle' | 'error'`.
- On mount: `fetch('/api/decks')`. If response is `{ ok: true, decks: [] }`, POST `/api/decks` with `{ name: "My Deck" }`; on success, populate `decks` with the new deck and select it. Else populate from the response.
- Default selection: `sessionStorage.getItem('lastUsedDeckId')` if present AND it matches a deck in the list; else the first deck in the (newest-first) list.
- Render a `<select>` (or shadcn `Select` if we want to add the primitive — for MVP a plain styled `<select>` is fine; do NOT add a new shadcn primitive just for this) above the textarea, with one `<option>` per deck (`value={deck.id}`, label = deck name). The select is disabled when `status === 'submitting'` or `decksStatus !== 'idle'` or `decks.length === 0` (which shouldn't happen post-lazy-create).
- Submit button is also disabled if `selectedDeckId === null`.
- On submit: capture `requestStartedAt = new Date().toISOString()` BEFORE the fetch; include `deck_id: selectedDeckId` in the POST body to `/api/cards/generate`.
- On success: `sessionStorage.setItem('lastUsedDeckId', selectedDeckId)`; `window.location.href = `/decks/${selectedDeckId}?since=${encodeURIComponent(requestStartedAt)}``. (Full navigation, not SPA — keeps the implementation tiny.)
- On failure: existing error-toast pathway unchanged; the textarea retains the user's text so they can retry. NO navigation on failure.
- Remove all rendering of the "Latest batch" list, the `cards` local state, and the `successMessage` `Alert` (the success state lives on the deck detail page now). The component returns to a smaller shape: dropdown + textarea + counter + button + progress bar + error alert.
- Add a small "Manage decks →" link near the dropdown (or below it) that navigates to `/decks` for users who want to rename/delete decks without going through the deck detail page first.

#### 2. Dashboard layout polish

**File**: `src/pages/dashboard.astro`

**Intent**: Minor copy/structure update to reflect that `/dashboard` is the paste entry point and `/decks` is the management view. No behavioral change beyond what `PasteToGenerate` does.

**Contract**: Add a "View decks →" link in the header area (next to the sign-out form) so users can reach `/decks` from the dashboard without going through the PasteToGenerate dropdown. Heading/subheading copy may be tightened to "Generate cards" / "Paste text to add flashcards to a deck." Optional; keep the existing structure if changes feel scope-creepy.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro check` passes.
- `npm run build` passes.

#### Manual Verification:

- **Fresh user with no decks**: sign in as a brand-new account; navigate to `/dashboard`; on first render, a single `My Deck` appears in the dropdown (verify via Studio that a deck row was created via the lazy-create POST).
- **Existing user with decks**: dashboard's dropdown shows every deck the user owns, newest-first by `created_at` desc; the first entry is selected by default.
- **`lastUsedDeckId` persistence**: pick a non-default deck; generate cards; navigate back to `/dashboard`; the dropdown defaults to that same deck again. Clear sessionStorage; reload; default reverts to the newest deck.
- **Happy path (with deck context)**: pick a target deck, paste ~2 000 chars, click generate; progress UX appears; on response, browser navigates to `/decks/<selectedDeckId>?since=<iso>`; the deck detail page shows the new cards at the top with NEW badges + "N new cards added" banner.
- **Failure path**: with `OPENROUTER_API_KEY` unset, paste + generate → English error toast; textarea preserved; user stays on `/dashboard`; no navigation; no DB rows added.
- **Removed "Latest batch"**: confirm the dashboard no longer renders the in-place batch list — only the dropdown / textarea / progress / error UI.
- **Invalid `deck_id` from a stale tab**: open the dashboard in tab A; in tab B, delete the selected deck (it cascades all cards); back in tab A, paste + generate → 404 `DECK_NOT_FOUND` from the API; English error toast "This deck no longer exists. Reload to pick another."; reload restores the dropdown to a valid selection.
- **Manage decks link**: clicking "Manage decks →" navigates to `/decks`.
- **No regressions in S-01 privacy posture**: `rg -n 'console\.(log|error|warn|info|debug)' src/components/cards/PasteToGenerate.tsx` → no logging of `text` value or LLM response; deck_id and deck name OK if absolutely needed (prefer none).

**Implementation Note**: After Phase 5 passes both verifications, the slice is shippable end-to-end. Run the full smoke flow before merging.

---

## Testing Strategy

### Automated:

Per project convention, no test runner. Per-phase verification gates are `npm run lint`, `npx astro check`, `npm run build`, and the existing CI `db reset` + `db:types` diff. Phase 1 also runs two RLS isolation tests against both local and hosted DBs: `npm run db:test:rls` runs the cards isolation test (updated for `deck_id NOT NULL`); `npm run db:test:rls:decks` runs the new decks isolation test.

### Manual:

Each phase's Manual Verification list is the gate. Phase 2 owns the cross-user 404 isolation tests; Phase 5 owns the end-to-end smoke flow.

### Smoke flow end-to-end (after Phase 5):

1. Sign in as user A.
2. Visit `/decks` — confirm "My Deck" (backfilled if S-01 cards existed) plus any test decks.
3. Create deck "Smoke 1"; create deck "Smoke 2"; rename "Smoke 1" to "Renamed"; delete "Renamed" (0 cards, confirm dialog says so).
4. Navigate to `/decks/<Smoke 2 id>`; add a card manually (front "F", back "B"); edit it; delete it with the confirm.
5. Navigate to `/dashboard`; pick "Smoke 2" in the dropdown; paste a 2 000-char excerpt; generate.
6. Confirm browser navigates to `/decks/<Smoke 2 id>?since=<iso>`; banner reads "N new cards added"; first N rows show NEW badges.
7. Dismiss the banner; URL drops the query param; badges remain.
8. Reload — badges and banner gone (since param no longer in URL).
9. Sign out; `curl POST /api/decks` → 401; `curl GET /api/decks/<smoke-2-id>/cards` → 401.
10. Sign in as a fresh user B; visit `/decks` — no "Smoke 2" visible (RLS isolation).
11. `curl PATCH /api/cards/<A's card uuid>` from B's session → 404.
12. `wrangler tail --format pretty` while running step 5 → no substring of the pasted text appears.

## Performance Considerations

- **CPU budget on Workers Standard ($5/mo)**: 30 s default, 5 min max per invocation. Per-request DB work is small: `GET /api/decks` is one query (with a foreign-table count aggregate); `GET /api/decks/[id]/cards` is one query with `LIMIT 500`; mutations are one statement each. The generate route's deck-ownership check adds one extra `SELECT` before the LLM call (negligible CPU; ~5 ms typical). No blow-up risk.
- **Subrequest count per generate invocation**: 1 (deck-ownership SELECT) + 1 (LLM call) + 1 (Supabase insert) + 1 (auth.getUser) ≈ 4. Well under the 1 000 cap.
- **List-endpoint payload cap**: 500 rows on the cards list per deck. At ~200 bytes per row (UUID + two short strings + timestamp), the worst-case payload is ~100 kB — fine over a Worker response.
- **Bulk-insert pattern from S-01 carries over**: the generate route still does one INSERT per batch (now with `deck_id` injected), one subrequest. The user-confirmed plan deliberately avoids per-card loops.
- **No client-side caching / SWR / React Query**: state is local to each island; we re-fetch on full page navigations. For MVP volumes this is fine; revisit if list-load latency becomes user-visible.

## Migration Notes

This slice introduces one SQL migration (Phase 1) that mutates the existing `cards` table. Sequence at deploy time, treating the slice as one atomic deploy:

1. `npx supabase db push` to apply the new migration to the hosted DB (creates `decks`, adds `cards.deck_id`, backfills, locks NOT NULL).
2. `HOSTED_DB_URL=... npm run db:test:rls:linked` and `... db:test:rls:decks:linked` to confirm RLS isolation against hosted.
3. Verify in the Supabase dashboard that backfill ran (existing users have a "My Deck" with their original cards).
4. `npm run build && npx wrangler deploy` (no new env vars or secrets in this slice — `wrangler secret put` is not needed; `lessons.md` rule about production-env-var rollout doesn't apply here, but the schema-push step IS the migration-equivalent for this slice).
5. Smoke-test the deployed URL using the flow in "Smoke flow end-to-end".

**Rollback**: rolling back the deploy alone is safe — the schema is additive (`cards.deck_id` not null) but the application bundle that uses it can be reverted to an S-01 build. **However**, S-01-era code does not write `deck_id` and would fail every insert against the new schema. Rolling back means rolling back BOTH the code and the migration. The migration's `down` direction would: `ALTER TABLE cards DROP COLUMN deck_id`, then `DROP TABLE decks`. Supabase's migration tooling does not auto-generate down migrations; if rollback is needed, write a manual reverse migration. The backfill is destructive in the down direction (the "My Deck" rows get lost), but the cards data is preserved as long as the down migration runs `DROP COLUMN deck_id` rather than `DROP TABLE cards`.

**Existing data**: any user who created cards via S-01 will see those cards in their auto-created "My Deck" after the migration. No user-visible data loss. No new env vars are introduced by this slice.

## References

- Roadmap entry: `context/foundation/roadmap.md:92-104` (S-02 outcome + PRD refs)
- PRD: `context/foundation/prd.md:81-94` (FR-005/6/7/8), `:103-104` (FR-010, originally parked — un-parked by user decision in planning)
- Change identity: `context/changes/deck-management/change.md`
- F-01 (cards schema + migration / codegen / RLS-test pattern): `context/archive/2026-06-05-cards-schema-baseline/plan.md`
- S-01 (paste-to-AI-cards, the slice being integrated with): `context/archive/2026-06-05-ai-generate-from-paste/plan.md`
- Cards schema (extended in Phase 1): `supabase/migrations/20260605112924_cards_baseline.sql`
- Existing cards RLS test: `supabase/tests/rls_cards_isolation.sql`
- Supabase SSR client: `src/lib/supabase.ts`
- Generated DB types (regenerated in Phase 1): `src/db/database.types.ts`
- Middleware + protected routes: `src/middleware.ts`
- Existing PasteToGenerate island (modified in Phase 5): `src/components/cards/PasteToGenerate.tsx`
- Existing generate route (modified in Phase 2): `src/pages/api/cards/generate.ts`
- Existing shadcn primitives (used as templates for `alert-dialog`): `src/components/ui/{button,alert,textarea}.tsx`
- Lessons (no-lodash rule applies to all phases; prod-secret-rollout rule does NOT apply — no new env vars): `context/foundation/lessons.md`
- Deploy runbook (extended in Phase 1 step 5): `context/changes/deployment/runbook.md`
- Infrastructure constraints: `context/foundation/infrastructure.md`

## Open Risks & Assumptions

- **FR-010 was parked in the PRD as nice-to-have**; this slice un-parks it by user decision. The roadmap's S-02 outcome line ("views every card in their deck") implies single-deck; once this slice ships, both the roadmap and PRD should be updated (PRD: promote FR-010 to must-have; roadmap S-02: rewrite outcome to mention multiple decks). Outside this slice's scope — flagged for `/10x-archive` to surface.
- **Foreign-table count aggregation in Supabase JS**: the `GET /api/decks` endpoint relies on Supabase JS's ability to return a foreign-table count. Two-query fallback documented in Phase 2 if the API shape proves awkward at implementation time.
- **Lazy-create race condition**: if a user opens `/dashboard` in two browser tabs simultaneously on a fresh account, both could see `GET /api/decks` return empty and both POST a "My Deck" — resulting in two "My Deck" decks. Acceptable for MVP (the user can rename or delete one); mitigations (unique constraint on `(user_id, name)`, server-side single-shot creation) are deliberately deferred.
- **`sessionStorage.lastUsedDeckId` can point at a deleted deck**: handled at submit time (the 404 path in Phase 5's manual verification). The dropdown's mount-time validation against the current decks list catches most of these; only a race between a delete in tab B and a paste in tab A reaches the API-level 404.
- **NEW badges have no auto-expiry**: deliberate. The badges go away on reload; the banner dismissal removes the query param. If a user keeps the deck page open for hours, the badges stay until they navigate. Acceptable.
- **AGENTS.md / English UI tension carries forward**: same as S-01. All new UI text is English.
- **Wrangler `observability.enabled: true` + no body sampling**: same NFR-2 carry-over note as S-01 — re-verify if any new logging is added in this slice. The plan deliberately adds none.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema baseline — `decks` table + `cards.deck_id` + backfill + RLS test

#### Automated

- [x] 1.1 New migration file exists at `supabase/migrations/*_decks_baseline.sql` — 2b50cf0
- [x] 1.2 `npx supabase db reset` exits 0 — 2b50cf0
- [x] 1.3 `npm run db:types` exits 0; `src/db/database.types.ts` has `decks` and `cards.deck_id` — 2b50cf0
- [x] 1.4 `npm run db:test:rls` exits 0 (cards test updated for `deck_id`) — 2b50cf0
- [x] 1.5 `npm run db:test:rls:decks` exits 0 — 2b50cf0
- [x] 1.6 `npm run lint` passes — 2b50cf0
- [x] 1.7 `npx astro check` passes — 2b50cf0
- [x] 1.8 `npm run build` passes — 2b50cf0

#### Manual

- [x] 1.9 Studio shows `decks` table with four RLS policies and `cards.deck_id` with FK — 2b50cf0
- [x] 1.10 Existing cards have non-null `deck_id` pointing at a per-user "My Deck" — 2b50cf0
- [x] 1.11 `npx supabase db push` applies to hosted DB; hosted `pg_policies` count = 4 on `decks` — 2b50cf0
- [x] 1.12 Both RLS tests pass against hosted DB — 2b50cf0
- [x] 1.13 Supabase dashboard policies view shows all four decks policies — 2b50cf0

### Phase 2: REST API — decks CRUD + deck-scoped cards CRUD + generate-route `deck_id`

#### Automated

- [x] 2.1 `npm run lint` passes — 36f46fa
- [x] 2.2 `npx astro check` passes — 36f46fa
- [x] 2.3 `npm run build` passes — 36f46fa
- [x] 2.4 CI types-in-sync guardrail (`git diff --exit-code src/db/database.types.ts`) unaffected — 36f46fa

#### Manual

- [x] 2.5 `curl GET /api/decks` returns user's decks with card_count — 36f46fa
- [x] 2.6 `curl POST /api/decks` creates a deck; visible in Studio — 36f46fa
- [x] 2.7 `curl PATCH /api/decks/[id]` renames; `curl DELETE /api/decks/[id]` deletes and cascades cards — 36f46fa
- [x] 2.8 `curl GET /api/decks/[id]/cards` returns newest-first; `curl POST .../cards` creates with correct deck_id — 36f46fa
- [x] 2.9 `curl PATCH /api/cards/[id]` edits; `curl DELETE /api/cards/[id]` deletes a single card — 36f46fa
- [x] 2.10 `curl POST /api/cards/generate` with valid `deck_id` saves cards; without `deck_id` returns 400; with another user's `deck_id` returns 404 — 36f46fa
- [x] 2.11 Cross-user isolation: user B's session cannot mutate user A's decks or cards (404 returned) — 36f46fa
- [x] 2.12 Every endpoint without cookie returns 401 — 36f46fa
- [x] 2.13 NFR-2 carry-over: `rg console\.` in new API files and `src/lib/llm/` shows no logging of `text` or LLM I/O — 36f46fa
- [x] 2.14 `src/lib/api/errors.ts` exists; `generate.ts` and all five new routes import `errorResponse` from it (no inline `ErrorCode` / `ERROR_MESSAGES` / `STATUS_BY_CODE` redeclarations outside `errors.ts`) — 36f46fa

### Phase 3: `/decks` list page + AlertDialog primitive + deck CRUD UI

#### Automated

- [x] 3.1 `npm run lint` passes — 6c601c7
- [x] 3.2 `npx astro check` passes — 6c601c7
- [x] 3.3 `npm run build` passes — 6c601c7

#### Manual

- [x] 3.4 `/decks` renders deck list for signed-in user; "My Deck" present if backfill ran — 6c601c7
- [x] 3.5 Anonymous `/decks` → redirected to `/auth/signin` — 6c601c7
- [x] 3.6 "+ Add deck" creates a new deck; prepended to list — 6c601c7
- [x] 3.7 Rename swaps row to inline input; Save updates; Cancel discards — 6c601c7
- [x] 3.8 Delete (empty deck) shows "0 cards" in confirm; on confirm, row removed — 6c601c7
- [x] 3.9 Delete (deck with cards) shows correct count; cards cascade-delete in Studio — 6c601c7
- [x] 3.10 Empty-state copy renders when zero decks — 6c601c7
- [x] 3.11 Server error during mutation shows English error toast and preserves list — 6c601c7
- [x] 3.12 Empty/over-length name validation handled gracefully — 6c601c7

### Phase 4: `/decks/[id]` detail page — card CRUD UI + `NewCardsBanner`

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npx astro check` passes
- [x] 4.3 `npm run build` passes

#### Manual

- [x] 4.4 `/decks/[id]` renders cards newest-first with deck name in heading
- [x] 4.5 Anonymous `/decks/[id]` → redirected to `/auth/signin`
- [x] 4.6 Navigating to another user's deck id shows error state ("Couldn't load this deck...")
- [x] 4.7 "+ Add card" creates a card via POST; prepended to list
- [x] 4.8 Edit swaps row to inline edit fields; Save updates; Cancel discards
- [x] 4.9 Delete shows confirm with front preview; confirm removes the row
- [x] 4.10 Empty-state copy renders when zero cards
- [x] 4.11 500-cap banner renders when `cards.length === 500`
- [x] 4.12 `?since=<iso>` URL: banner shows "N new cards added"; rows with `created_at >= since` show NEW badge
- [x] 4.13 Dismissing the banner removes the query param from URL; NEW badges remain until reload
- [x] 4.14 Empty front/back disables Save in edit mode
- [x] 4.15 Server error during edit shows English toast; row stays in edit mode (adapted from plan: preserves typed changes for retry per user preference)

### Phase 5: Dashboard paste-flow integration — deck dropdown, lazy-create, navigate

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 `npx astro check` passes
- [ ] 5.3 `npm run build` passes

#### Manual

- [ ] 5.4 Fresh user with zero decks: dashboard lazy-creates "My Deck" via POST `/api/decks` on first mount
- [ ] 5.5 Existing user: dropdown shows all decks newest-first; first entry selected by default
- [ ] 5.6 `sessionStorage.lastUsedDeckId` persists across visits; cleared sessionStorage reverts to default
- [ ] 5.7 Happy path: pick deck → paste → generate → browser navigates to `/decks/[id]?since=<iso>` → banner + NEW badges visible
- [ ] 5.8 Failure path: LLM error shows toast; textarea preserved; no navigation; no DB rows added
- [ ] 5.9 "Latest batch" rendering removed from dashboard
- [ ] 5.10 Stale-tab deck deletion: paste in tab A after deleting selected deck in tab B → 404 error toast; reload restores valid dropdown
- [ ] 5.11 "Manage decks →" link navigates to `/decks`
- [ ] 5.12 No `console.*` of `text` value or LLM response in modified `PasteToGenerate.tsx`
- [ ] 5.13 End-to-end smoke flow (steps 1-12 in Testing Strategy) passes
