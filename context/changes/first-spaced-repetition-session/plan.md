# First Spaced-Repetition Session (S-03) Implementation Plan

## Overview

Ship the **north-star** slice: a logged-in user on `/study/[deckId]` reviews the cards in their deck whose `due ≤ now()` one at a time, rates recall (Again/Hard/Good/Easy), and finishes with a summary card. Scheduling is computed by `ts-fsrs@^5.4` wrapped behind `src/lib/study/service.ts`; full FSRS Card state is persisted on the `cards` row and every review is appended to a new `review_logs` table whose `UNIQUE(card_id, review)` doubles as the idempotency anchor. When the user returns the next day, the same deck shows due cards again. Closes PRD US-01 (study arm), FR-009, Primary SC, Guardrails-2; abides by Non-Goal-1.

## Current State Analysis

- **F-01 (cards-schema-baseline)** is `done`: `cards(id, user_id, deck_id, front, back, created_at)` exists with RLS gated on `user_id = auth.uid()` and `idx_cards_user_id`. No FSRS columns yet, no `review_logs` table, no `updated_at` trigger.
- **S-01 (ai-generate-from-paste)** is `done`: established the JSON-in/JSON-out API convention, the `{ ok, error: { code, message } }` envelope (`src/lib/api/errors.ts`), `supabase.auth.getUser()` + `errorResponse("UNAUTHORIZED")` auth pattern (`src/pages/api/cards/generate.ts:24-34`), and the LLM domain-service precedent (`src/lib/llm/openrouter.ts`).
- **S-02 (deck-management)** is `done`: supplies `decks` table, `DeckRow` action bar with `Rename`/`Delete` buttons (`src/components/decks/DeckRow.tsx:81-93`), the deck-ownership check pattern (`src/pages/api/cards/generate.ts:40-48`), and the two-user RLS smoke template `supabase/tests/rls_decks_isolation.sql`.
- `src/middleware.ts:4` defines `PROTECTED_ROUTES = ["/dashboard", "/decks"]` — `/study` not yet listed.
- `src/components/ui/` ships Button, Alert, AlertDialog, Textarea. No `card.tsx` primitive.
- No test runner (per roadmap baseline). Verification is `npm run lint && npm run build` + manual smoke.
- No production env vars to add — `ts-fsrs` has no API key.
- `src/lib/study/` does not exist.

## Desired End State

After this plan lands, the following is true and verifiable end-to-end:

1. Supabase has 10 net-new FSRS columns on `public.cards` (`difficulty`, `due`, `elapsed_days`, `lapses`, `last_review`, `learning_steps`, `reps`, `scheduled_days`, `stability`, `state`) with sensible defaults so existing rows present as "new" cards (`state = 0`, `due = now()`); a new `public.review_logs` table with `UNIQUE(card_id, review)`; RLS on `review_logs` denies cross-user access verified by `supabase/tests/rls_review_logs_isolation.sql`; index `cards(user_id, due)` exists.
2. `src/db/database.types.ts` reflects all of the above (regenerated via `npm run db:types`).
3. `ts-fsrs@^5.4` is installed; `src/lib/study/service.ts` exposes `getNextDueCard`, `applyRating`, `previewIntervals` and is the only module that imports `ts-fsrs`.
4. `GET /api/study/next?deckId=<uuid>` returns the next due card + the four interval previews; `POST /api/study/review` persists the log + advances the card atomically and is safe to replay (idempotent via DB-level conflict).
5. `/study/[deckId]` is a protected route. The page shows one card at a time, reveals the back + 4 labeled rating buttons (Again/Hard/Good/Easy) with interval-preview subtitles on a single click of "Show answer" (or Space). Keyboard `1`–`4` map to ratings. On queue exhaustion, an inline summary card shows reviewed counts + a "Come back tomorrow" prompt + "Back to deck" link. Empty case ("nothing due") shows the same summary shape with reviewed counts at zero. (Computing a precise next-due relative time is deferred — see Phase 4 component contract.)
6. `DeckRow` action bar has a "Study" button (next to Rename/Delete) that navigates to `/study/<deckId>`.
7. Manual smoke checklist (Phase 5) passes: new card flow, returning-day flow, idempotency replay, RLS two-user isolation, empty/end states.

### Key Discoveries

- ts-fsrs `Card` interface is 10 primitive/`Date` fields — all map to native Postgres types, no jsonb gymnastics needed (`context/changes/first-spaced-repetition-session/ts-fsrs-api-docs.md:37-50`).
- `ReviewLog.elapsed_days` and `ReviewLog.last_elapsed_days` are **deprecated and removed in 6.0.0** — do NOT add columns for them on `review_logs` (`ts-fsrs-api-docs.md:66`). `Card.elapsed_days` is still live and must be persisted.
- The deck-ownership check at `src/pages/api/cards/generate.ts:40-48` (`SELECT id FROM decks WHERE id=? AND user_id=?` → 404 on miss) is the canonical pattern; clone it in `GET /api/study/next`.
- `ErrorCode` is a string-literal union in `src/lib/api/errors.ts:10-22` — each new code requires entries in `ErrorCode`, `ERROR_MESSAGES`, and `STATUS_BY_CODE`.
- `src/components/decks/DeckRow.tsx:81-93` shows the action-bar slot: `<div className="flex gap-2">` holds the buttons. Add `Study` as the first button.
- The starter routing template at `src/pages/decks/[id].astro` is 15 lines — clone for `/study/[deckId].astro`.

## What We're NOT Doing

- No custom FSRS implementation (Non-Goal-1) — `scheduler.next()` output is persisted verbatim, never recomputed.
- No per-user FSRS parameter tuning at MVP — library defaults (`request_retention: 0.9`, `maximum_interval: 36500`, `enable_fuzz: true`) are used. Future work parks a `user_fsrs_params jsonb` column.
- No cross-deck "review everything" queue — `/study/[deckId]` only. A future `/study` route can pool decks.
- No dashboard "Start study session" CTA — entry point is `DeckRow` only per roadmap §S-03 Parallel-with.
- No client-side `Idempotency-Key` header — DB-level `UNIQUE(card_id, review) + ON CONFLICT DO NOTHING + re-read` is sufficient for Guardrails-2 at MVP scale.
- No Postgres `CREATE TYPE` enums for `state`/`rating` — `smallint` with column comments matches ts-fsrs JSON integer serialization round-trip.
- No `card_count_due` precomputed column on decks — the queue is computed on demand.
- No Sentry / structured logging beyond what `wrangler tail` exposes (per `roadmap.md ## Parked`).
- No test runner introduction (per roadmap baseline) — smoke-test by hand.
- No production env var changes (`ts-fsrs` has no API key). Stated explicitly so `/10x-impl-review` does not flag the `lessons.md` "production env-var rollout" rule as missing.

## Implementation Approach

Five sequential phases, each gated by its own automated + manual verification. Schema first so codegen lands before any service code references it. Service module before API routes so handler files stay thin and the FSRS coupling lives in one place. API routes before UI so the React component talks to real endpoints from the first render. Entry point last so a half-finished session can't be linked-to from production code.

## Critical Implementation Details

- **`Card.last_review` is nullable on a brand-new card** — ts-fsrs's `createEmptyCard()` does not set it. Defaulting the column to `null` lets row-level type codegen produce `string | null`, which the service must accept on the input side and emit on the output side without coercion to a sentinel timestamp.
- **`review` timestamp comes from the client, not `now()` server-side** — the idempotency contract is `UNIQUE(card_id, review)`. If the server set `review = now()` per request, two retries one millisecond apart would each succeed. The client sends an ISO-8601 `review_at` it captured at the moment of the rating click; the server validates it's within ±60s of `now()` and persists it as `review`.
- **`scheduler.next()` is pure given `(card, now, rating)`** — that means the service can re-run it deterministically on the existing log row during a conflict re-read, but it MUST be re-run against the **card row's current state**, not against the input card snapshot the client sent. The client never sends card state; the server fetches it.
- **Keyboard handler should ignore key events while the back is hidden** — pressing `1`–`4` on a front-only card would submit a rating without the user seeing the answer, defeating the SR mechanic. The `useEffect` that wires `keydown` checks the "revealed" state before forwarding the key.

## Phase 1: Schema + codegen

### Overview

Add 10 FSRS columns to `cards`, create `review_logs`, wire RLS + indexes, regenerate types.

### Changes Required:

#### 1. FSRS migration

**File**: `supabase/migrations/20260613HHMMSS_fsrs_state_and_review_logs.sql` (replace `HHMMSS` with actual time at write)

**Intent**: Apply the additive schema delta that makes existing cards behave as "new" FSRS cards (`state=0`, `due=now()`, all metrics 0), creates an append-only `review_logs` table with the idempotency anchor and a denormalized `user_id` for cheap RLS, adds the due-cards index, and enables RLS with select+insert policies on `review_logs` that gate on `user_id = auth.uid()`. No backfill needed; column defaults cover existing rows.

**Contract**:

- `ALTER TABLE public.cards` adds 10 columns: `difficulty float8 NOT NULL DEFAULT 0`, `due timestamptz NOT NULL DEFAULT now()`, `elapsed_days integer NOT NULL DEFAULT 0`, `lapses integer NOT NULL DEFAULT 0`, `last_review timestamptz NULL`, `learning_steps integer NOT NULL DEFAULT 0`, `reps integer NOT NULL DEFAULT 0`, `scheduled_days integer NOT NULL DEFAULT 0`, `stability float8 NOT NULL DEFAULT 0`, `state smallint NOT NULL DEFAULT 0`.
- `COMMENT ON COLUMN public.cards.state IS '0=New, 1=Learning, 2=Review, 3=Relearning (ts-fsrs State enum)'`.
- `CREATE INDEX idx_cards_user_due ON public.cards (user_id, due)`.
- `CREATE TABLE public.review_logs (id uuid PK default gen_random_uuid(), card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, difficulty float8 NOT NULL, due timestamptz NOT NULL, learning_steps integer NOT NULL, rating smallint NOT NULL, review timestamptz NOT NULL, scheduled_days integer NOT NULL, stability float8 NOT NULL, state smallint NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`.
- `COMMENT ON COLUMN public.review_logs.rating IS '1=Again, 2=Hard, 3=Good, 4=Easy (ts-fsrs Rating enum)'`; same `state` comment.
- `ALTER TABLE public.review_logs ADD CONSTRAINT review_logs_card_review_uniq UNIQUE (card_id, review)`.
- `CREATE INDEX idx_review_logs_card_id ON public.review_logs (card_id)`.
- `ENABLE ROW LEVEL SECURITY` + four policies cloned from `supabase/migrations/20260605112924_cards_baseline.sql:15-30`, gated on `user_id = auth.uid()`. Only `select` and `insert` are needed (no update/delete on log rows).
- Explicitly do NOT add `elapsed_days` or `last_elapsed_days` to `review_logs` (ts-fsrs 6.0.0 deletion).
- `CREATE FUNCTION public.record_review(p_card_id uuid, p_rating smallint, p_review_at timestamptz, p_card_patch jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$ ... $$;` — single-transaction body inserts the `review_logs` row with `ON CONFLICT (card_id, review) DO NOTHING`, applies `p_card_patch` to `cards` (UPDATE … SET difficulty = ($1->>'difficulty')::float8, …, due = ($1->>'due')::timestamptz, … WHERE id = p_card_id), and returns the canonical post-operation `cards` row as jsonb. On conflict (no log row inserted) the function re-reads and returns the current card row WITHOUT applying the patch — making the rpc idempotent for any (card_id, review_at) pair. `SECURITY INVOKER` so RLS on both tables still applies to the caller. `GRANT EXECUTE ON FUNCTION public.record_review(uuid, smallint, timestamptz, jsonb) TO authenticated`.

#### 2. RLS isolation smoke test

**File**: `supabase/tests/rls_review_logs_isolation.sql`

**Intent**: Clone the two-user pattern from `supabase/tests/rls_cards_isolation.sql` to prove user B cannot `SELECT` or `INSERT` against user A's `review_logs` rows. Lives alongside its sibling and is executed with the same psql invocation already used for the cards isolation test.

**Contract**: Sets `request.jwt.claims` for user A, inserts a card + review log, switches to user B, asserts SELECT returns zero rows AND INSERT into user A's `card_id` is rejected by the policy.

#### 3. Regenerate database types

**File**: `src/db/database.types.ts` (generated)

**Intent**: Refresh the generated `Database` type so `Tables<"cards">`, `TablesInsert<"cards">`, and the new `Tables<"review_logs">` / `TablesInsert<"review_logs">` reflect the migration. Run `npm run db:types` and commit the diff.

**Contract**: Script from `package.json:13` (`db:types`). No manual edits.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a fresh local Supabase: `npx supabase db reset`
- TypeScript compiles after codegen refresh: `npm run build`
- Lint passes: `npm run lint`
- RLS isolation test passes: `psql … -f supabase/tests/rls_review_logs_isolation.sql` (manual psql run, same flow as F-01)

#### Manual Verification:

- After `db:reset`, `supabase studio` shows `cards` with 10 new columns + comment, `review_logs` table present with unique constraint, indexes visible, RLS enabled on both tables, and the `record_review` function listed under Database → Functions with `SECURITY INVOKER` and `EXECUTE` granted to `authenticated`.
- A pre-existing card row in seed data presents as `state=0`, `due=now()`, all metrics 0 (so the next call to ts-fsrs's `createEmptyCard()` equivalent shape is satisfied by reading the row).

**Implementation Note**: After Phase 1 completes and automated verification passes, pause for manual confirmation that the migration looks correct in Supabase Studio before proceeding.

---

## Phase 2: Study service module + `ts-fsrs` dependency

### Overview

Install `ts-fsrs@^5.4`, scaffold `src/lib/study/`, and implement the single module that wraps the library. All FSRS imports live in this module; handlers depend only on its functions.

### Changes Required:

#### 1. Install ts-fsrs

**File**: `package.json`, `package-lock.json`

**Intent**: Add `ts-fsrs ^5.4` to `dependencies` (not `devDependencies` — runtime use). Verify the install with `npx tsc --noEmit` after.

**Contract**: `npm install ts-fsrs@^5.4`. No other config.

#### 2. Study domain types

**File**: `src/lib/study/types.ts`

**Intent**: Define DTOs the API + UI use so neither imports from `ts-fsrs` directly. Mirrors the LLM module's separation (`src/lib/llm/`). Includes the four-interval preview shape returned by `GET /api/study/next` and the rating-input shape accepted by `POST /api/study/review`.

**Contract**: Exports `Rating` as `1 | 2 | 3 | 4`, `IntervalPreview` (`{ rating: Rating; due: string }` per outcome), `StudyCardView` (`{ id, front, back, previews: IntervalPreview[] }`), `ReviewInput` (`{ card_id: string; rating: Rating; review_at: string }`), `ReviewResult` (`{ next: StudyCardView | null; summary?: { reviewed: number } }` — `next === null` signals queue exhausted).

#### 3. Zod schemas for the review endpoint

**File**: `src/lib/study/schemas.ts`

**Intent**: Validate the POST body shape and the `review_at` window (±60s of `now()`) before the service ever sees it. Mirrors `src/lib/cards/schemas.ts` and pairs with `classifyZodError` from `src/lib/api/errors.ts`.

**Contract**: Exports `ReviewRequestSchema` (Zod object: `card_id: z.string().uuid()`, `rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])`, `review_at: z.string().datetime()`) and a small `withinReviewWindow(iso: string): boolean` helper used by the route to reject clearly-stale or future timestamps with `INVALID_REQUEST`.

#### 4. Study service

**File**: `src/lib/study/service.ts`

**Intent**: The only module that imports `ts-fsrs`. Encapsulates: (a) converting a `cards` row into a ts-fsrs `Card`, (b) converting a ts-fsrs `Card` back into a `TablesUpdate<"cards">` patch, (c) computing the four interval previews for a card, (d) fetching the next due card for a (`userId`, `deckId`) pair ordered by `due ASC, id ASC` (LIMIT 1), (e) the persist-then-acknowledge `applyRating` routine — insert review log with `ON CONFLICT (card_id, review) DO NOTHING`, then on `INSERT … RETURNING` returning nothing (= conflict) re-read both the existing log and the current card, return the canonical card state either way.

**Contract**: Exports:

- `cardRowToFsrs(row: Tables<"cards">): Card`
- `fsrsToCardUpdate(card: Card): TablesUpdate<"cards">`
- `previewIntervals(card: Card, now: Date): IntervalPreview[]` (uses `scheduler.repeat`)
- `async getNextDueCard(supabase, userId, deckId): Promise<StudyCardView | null>`
- `async applyRating(supabase, userId, input: ReviewInput): Promise<ReviewResult>` — reads the card row (including `deck_id`), computes `{ card: nextCard } = scheduler.next(cardRowToFsrs(row), reviewAt, rating)`, builds a JSON patch via `fsrsToCardUpdate(nextCard)`, then calls `supabase.rpc('record_review', { p_card_id, p_rating, p_review_at, p_card_patch })` to perform the INSERT + UPDATE in a single Postgres transaction. The rpc returns the canonical post-operation card row (whether newly advanced or unchanged due to ON CONFLICT). Service then calls `getNextDueCard(supabase, userId, card.deck_id)` to return the next due card, or `{ next: null }` if queue is exhausted. Deck scoping is implicit through the card's own `deck_id` — `ReviewInput` deliberately does NOT carry `deck_id` so a client can't request a rating "for a different deck" than the card actually belongs to. All atomicity lives in the `record_review` function; the service is responsible for computing the FSRS patch and for the post-write next-card lookup.
- Module-private `scheduler = fsrs()` (default params; no per-user tuning at MVP).
- All Supabase errors map to `DB_QUERY_FAILED` / `DB_INSERT_FAILED` / `DB_UPDATE_FAILED` thrown as `Error` with the code as the message; the route translates via `errorResponse`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run build`
- Lint passes: `npm run lint`
- Format clean: `npm run format`
- `ts-fsrs` resolves at build time (no bundler warning): `npm run build` output contains no "Could not resolve" lines.

#### Manual Verification:

- A REPL-style sanity check (`npx tsx -e '...'` or via the first API route in Phase 3): given a freshly-created card row, `getNextDueCard` returns it; `applyRating` with `Rating.Good` advances `due` into the future and increments `reps`.

**Implementation Note**: Pause after Phase 2 for confirmation that the service module looks correctly isolated (handlers should import only from `@/lib/study/*`, never from `ts-fsrs`) before wiring API routes.

---

## Phase 3: API endpoints

### Overview

Add `GET /api/study/next` and `POST /api/study/review` following the established auth/envelope conventions. Extend `ErrorCode` with `REVIEW_CONFLICT`. The empty-queue case is NOT an error — `GET` returns `{ ok: true, card: null }`.

### Changes Required:

#### 1. Extend error codes

**File**: `src/lib/api/errors.ts`

**Intent**: Add one new code the study endpoints emit: `REVIEW_CONFLICT` (the rare client-side error where the `review_at` falls outside the ±60s window). The empty-queue case is NOT an error — `GET /api/study/next` returns `{ ok: true, card: null }`, mirroring `POST /api/study/review`'s `ReviewResult.next: StudyCardView | null` shape. This keeps the existing convention that `ok: false` only appears with 4xx/5xx HTTP statuses.

**Contract**:

- Append `"REVIEW_CONFLICT"` to `ErrorCode` union (lines 10-22).
- Add to `ERROR_MESSAGES`: `REVIEW_CONFLICT: "Review timestamp is out of range. Please try again."`.
- Add to `STATUS_BY_CODE`: `REVIEW_CONFLICT: 409`.

#### 2. `GET /api/study/next`

**File**: `src/pages/api/study/next.ts`

**Intent**: Return the next due card for the authenticated user in the given deck, plus the four interval previews. Auth + deck-ownership check mirror `src/pages/api/cards/generate.ts:24-48`. On empty queue, return `{ ok: true, card: null }` (success envelope; the client renders the empty-state summary).

**Contract**:

- `export const prerender = false`. `export const GET: APIRoute`.
- Parse `deckId` from `context.url.searchParams`; if missing or not a UUID, `errorResponse("INVALID_REQUEST")`.
- `createClient` + `supabase.auth.getUser()` → `UNAUTHORIZED` if missing.
- Deck-ownership: `select id from decks where id=$1 and user_id=$2` → `DECK_NOT_FOUND` if not found.
- `const view = await getNextDueCard(supabase, user.id, deckId)`.
- Return `new Response(JSON.stringify({ ok: true, card: view }), { status: 200, headers })` — `view` is `null` when the queue is empty; clients treat `card === null` as the empty/end-of-session signal (same shape as `ReviewResult.next`).
- Any thrown service `Error` whose message matches a `DB_*` code is forwarded via `errorResponse(...)`.

#### 3. `POST /api/study/review`

**File**: `src/pages/api/study/review.ts`

**Intent**: Persist a review log + advance the card atomically, returning the next due card (or `done: true`). Idempotent: replaying with the same `(card_id, review_at)` returns the same `next` view without double-advancing.

**Contract**:

- `export const prerender = false`. `export const POST: APIRoute`.
- Parse body JSON → `INVALID_REQUEST` on parse error.
- `ReviewRequestSchema.safeParse` → `classifyZodError(parsed.error, ["card_id", "rating", "review_at"])` on failure.
- `withinReviewWindow(review_at)` → `REVIEW_CONFLICT` if outside ±60s of `now()`.
- Auth as above (`UNAUTHORIZED`).
- Card-ownership: `select id, user_id from cards where id=$card_id and user_id=$user.id` → `CARD_NOT_FOUND` on miss (RLS would deny silently otherwise — explicit check returns a 404 instead of falling through to a confusing `DB_UPDATE_FAILED`).
- `const result = await applyRating(supabase, user.id, { card_id, rating, review_at })`.
- Return `new Response(JSON.stringify({ ok: true, next: result.next, done: result.next === null }), { status: 200, headers })`.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes (route registration + types).
- `npm run lint` passes.
- Curl smoke (with a valid session cookie):
  - `curl -b cookies.txt 'http://localhost:4321/api/study/next?deckId=<uuid>'` returns `{ ok: true, card: { id, front, back, previews: [...] } }` or `{ ok: true, card: null }` when the queue is empty.
  - `curl -b cookies.txt -X POST -H 'Content-Type: application/json' http://localhost:4321/api/study/review -d '{"card_id":"<uuid>","rating":3,"review_at":"<iso>"}'` returns `{ ok: true, next: { ... } | null, done: bool }`.

#### Manual Verification:

- Replay the same review POST twice within 60s with identical body — second call returns the same `next` view, and `select count(*) from review_logs where card_id=$1` is exactly 1.
- Rate a card `Again` (1) — `cards.due` advances by ~minutes; rate `Good` (3) — advances by days.
- Hit `/api/study/review` with `review_at = now() - 5min` — returns `REVIEW_CONFLICT` (409).
- Two-user check (uses the existing `rls_review_logs_isolation.sql` from Phase 1, plus a manual curl with user B's cookie against user A's `card_id`) — returns `CARD_NOT_FOUND` (not `DB_UPDATE_FAILED`).

**Implementation Note**: Pause after Phase 3 to confirm the idempotency replay works and the empty-queue case returns `{ ok: true, card: null }` cleanly before building the UI on top.

---

## Phase 4: Study session UI

### Overview

Add `/study/[deckId]` page + `StudySessionPage` React component implementing the single-screen reveal, 4 labeled rating buttons with interval previews, keyboard `1`–`4`, and the end-of-session summary card.

### Changes Required:

#### 1. Add `Card` shadcn primitive

**File**: `src/components/ui/card.tsx`

**Intent**: Standard shadcn Card primitive (Card / CardHeader / CardContent / CardFooter) used both for the flashcard front/back container and the end-of-session summary card. Follows the existing shadcn-style registry configured in `components.json`.

**Contract**: Stock shadcn `Card` (no design overrides). Imported via `@/components/ui/card`.

#### 2. Protected route registration

**File**: `src/middleware.ts`

**Intent**: Add `/study` to `PROTECTED_ROUTES` so unauthenticated visits to any `/study/*` URL redirect to `/auth/signin`.

**Contract**: `const PROTECTED_ROUTES = ["/dashboard", "/decks", "/study"];` (line 4).

#### 3. Page shell

**File**: `src/pages/study/[deckId].astro`

**Intent**: Clone the routing template at `src/pages/decks/[id].astro` — Layout + cosmic-themed container + `<StudySessionPage client:load />` with `deckId` lifted from `Astro.params`.

**Contract**: 15-line shell that passes `deckId={Astro.params.deckId ?? ""}` to `StudySessionPage`. Layout title `"Study"`.

#### 4. Session component

**File**: `src/components/study/StudySessionPage.tsx`

**Intent**: The interactive React component for the session. State machine: `loading → showFront → showAnswer → submitting → (next | done)`. Single-screen reveal — "Show answer" (or Space) toggles to the `showAnswer` state which renders the back text + 4 rating buttons together; clicking a button (or pressing `1`-`4`) calls `POST /api/study/review` with `review_at = new Date().toISOString()` and advances to the next card from the response. Track `reviewed: { again, hard, good, easy }` counters in component state for the summary. On `next === null` (queue exhausted) or on initial `NO_DUE_CARDS`, render the summary card with counts + next-due relative time + "Back to deck" link (`/decks`).

**Contract**:

- `interface Props { deckId: string }`. Pure `useState` + `useCallback` + `useEffect` (no zustand, no TanStack Query) per the convention at `src/components/cards/PasteToGenerate.tsx:40-47`.
- On mount: `GET /api/study/next?deckId=...`. On `{ ok: true, card: null }`: show empty-state summary. On `{ ok: true, card: { ... } }`: render the front.
- "Show answer" button + a `useEffect` keydown listener on `Space` (only fires when `showFront`). Disable the listener while `showAnswer` so `Space` doesn't double-submit.
- 4 rating buttons: labeled `Again` / `Hard` / `Good` / `Easy`, each with a subtitle showing the interval preview from `previews[i].due` rendered as relative time (e.g., "<10m", "<1d", "~3d", "~7d"). Buttons use `variant="destructive"` (Again), `variant="outline"` (Hard), default (Good), `variant="outline"` (Easy) — wire concrete variants in implementation; the spec is "4 visually distinguishable buttons in a row, Again is clearly the 'failure' affordance".
- Keyboard `1` / `2` / `3` / `4` map to the buttons via a `useEffect` keydown listener that is gated on `showAnswer` state (per "Critical Implementation Details").
- Submit handler: on rating-button click (or matching `1`–`4` keypress), capture `pendingReviewAt = new Date().toISOString()` into component state IF not already set for this card; reuse on transient-failure retries; clear after an acknowledged success response. This preserves the DB-level idempotency contract — a network retry resends the same `(card_id, review_at)` so the `record_review` rpc hits ON CONFLICT and the card never advances twice. Then `POST /api/study/review` with `{ card_id, rating, review_at: pendingReviewAt }`. On success increment the counter for the chosen rating, then if `done` show the summary, else advance to the new `next` card, reset to `showFront`, AND clear `pendingReviewAt`. On failure responses, handle by class: (a) **network error or 5xx** → keep `pendingReviewAt`, show retryable `Alert`, the next attempt is automatically idempotent; (b) **`REVIEW_CONFLICT` (409)** → the server didn't commit because the timestamp was outside the window, so regenerating it is safe: clear `pendingReviewAt` and let the next click capture a fresh one; (c) **`CARD_NOT_FOUND`** → don't retry the same card; show `Alert` and route back to `/decks/<deckId>`.
- Summary card renders: "Reviewed N cards" + a small table of (Again X / Hard Y / Good Z / Easy W) + "Back to deck" link to `/decks/{deckId}`. Empty case renders the same component with all counts zero and a friendly "Nothing due right now" header.
- The "next due" relative time on the summary (e.g., "Next card due in ~6h") is computed client-side from a small additional field returned by the API… actually, deferred: at MVP the summary shows "Reviewed N cards. Come back tomorrow." Hardcoded "Come back tomorrow" keeps Phase 4 scope tight; a follow-up can add a `nextDueAt` field on the summary response.

#### 5. Wire interval-preview formatting

**File**: `src/lib/study/format.ts`

**Intent**: A tiny pure helper that converts an ISO timestamp into a short relative-time label suitable for the rating-button subtitles ("<10m", "<1d", "~3d", "~7d"). Pure function, no React.

**Contract**: `export function relativeShort(iso: string, now = new Date()): string`. Bucketing: `< 1h → "<10m"` (or actual minutes), `< 1d → "<Nh"`, `< 30d → "~Nd"`, else `"~Nm"`.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes (route present, no import errors).
- `npm run lint` passes (no unused vars, no missing key warnings).
- `npm run format` clean.

#### Manual Verification:

- Visit `/study/<deckId>` while logged out → redirected to `/auth/signin`.
- Visit while logged in with at least one due card → front is shown.
- Click "Show answer" → back + 4 buttons appear; click `Good` → next card loads OR summary appears if queue empty.
- Press `Space` while on front → back appears (same as button).
- Press `1`/`2`/`3`/`4` while on the answer view → matching rating submitted; pressing them on the front does nothing.
- Counts on the summary card match the actual ratings clicked.
- Empty case: visit a deck with no due cards → summary card with zero counts + "Nothing due right now" + "Back to deck" link works.
- Mobile viewport (≤375px wide): the 4 buttons stay tappable (wrap to 2x2 if needed).

**Implementation Note**: Pause after Phase 4 to confirm the manual flow before adding the entry-point button. A broken session screen plus a button to it is worse than a working session with no button.

---

## Phase 5: Entry point + smoke pass

### Overview

Add the "Study" button to `DeckRow` and run the full end-to-end smoke checklist that satisfies Guardrails-2 and the Primary SC.

### Changes Required:

#### 1. DeckRow Study button

**File**: `src/components/decks/DeckRow.tsx`

**Intent**: Add a "Study" button as the first action in the existing `<div className="flex gap-2">` block (lines 81-93), navigating to `/study/<deckId>` via plain `<a>` or `Button asChild` wrapping `<a>`. No new state needed.

**Contract**: A `Button` with `size="sm"`, default (primary) variant to make it the affordance the eye lands on first, label `"Study"`, navigates to `` `/study/${deck.id}` ``. Placed before Rename/Delete.

#### 2. Smoke checklist (no code)

**File**: none (verification only)

**Intent**: Run the end-to-end smoke that proves the slice satisfies Primary SC + Guardrails-2 before declaring `done`.

**Contract**: See Manual Verification below.

### Success Criteria:

#### Automated Verification:

- `npm run build` + `npm run lint` + `npm run format` all clean.
- CI (lint + build) green on the PR.

#### Manual Verification:

- **Golden path:** From `/decks`, click `Study` on a deck with cards → land on `/study/<deckId>` → see front → reveal → rate → next card → … → summary card with correct counts. End-to-end with NO console errors.
- **Returning-day flow:** In Supabase Studio, manually set one card to `due = now() - interval '1 day'`. Reload `/study/<deckId>` → that card appears.
- **Idempotency replay:** With browser devtools, capture a successful `POST /api/study/review` request, replay it via "Resend" — server response is identical, and `select count(*) from review_logs where card_id=$1` is still 1.
- **RLS two-user smoke:** Sign in as user A, create a card, rate it. Sign out, sign in as user B, hit `/study/<userA-deckId>` directly (URL-edit) → page renders `DECK_NOT_FOUND` summary state, NOT user A's card. `select * from review_logs` while authenticated as user B returns 0 rows.
- **No regressions:** dashboard loads, deck list loads, paste-to-generate flow still works, deck rename/delete still work, signout still works.
- **No production env vars touched:** confirm `.dev.vars` and the Cloudflare dashboard list of secrets is unchanged from before the PR.

**Implementation Note**: Phase 5 closes the slice. Once all manual checks pass, mark the Progress section complete and proceed to `/10x-impl-review first-spaced-repetition-session` per the project's flow.

---

## Testing Strategy

### Unit Tests

- N/A — no test runner installed (per roadmap baseline; deferred until first user-reported regression).

### Integration Tests

- N/A — same.

### Manual Testing Steps

1. Apply migrations: `npx supabase db reset`. Verify schema in Supabase Studio.
2. Regenerate types: `npm run db:types`. Confirm `database.types.ts` diff is exactly the new columns + `review_logs` table.
3. Run RLS isolation: `psql ... -f supabase/tests/rls_review_logs_isolation.sql`. Confirm exit 0.
4. Run dev: `npm run dev`. Sign in. Paste a deck of ~10 cards via the existing `/decks/<id>` paste-to-generate flow.
5. Click `Study` on the deck → walk the session, rating a mix of `Again`/`Good`/`Easy`. Confirm counts on the summary card match what was clicked.
6. In Supabase Studio, set one card's `due` to `now() - interval '1d'`. Reload `/study/<deckId>` → that card is the front shown.
7. Devtools "Resend" the last review POST → server response identical; row count unchanged.
8. Sign out → sign in as a second user → URL-edit to user A's deck → confirm no access (`DECK_NOT_FOUND` state).
9. Regression sweep: dashboard, deck list, paste flow, rename, delete, signout — all unchanged.

## Performance Considerations

- The `idx_cards_user_due` composite index makes the next-due query a single index scan even on a per-user backlog of thousands of cards.
- `scheduler.next()` / `scheduler.repeat()` are microseconds per card (per `library-research.md`). No risk of CPU-time budget pressure on Workers; `nodejs_compat` is sufficient.
- Bundle: `ts-fsrs` adds ~10 KiB to the server bundle (per `research.md`); current `dist/server/` is ~2.2 MiB uncompressed — well under any cap.
- No new subrequests per card (the entire study endpoint is one auth check + one deck check + one card SELECT + one log INSERT + one card UPDATE → 4 Supabase queries; the existing generate route uses comparable or more).

## Migration Notes

- The migration is forward-only. Existing rows in `cards` auto-populate with FSRS defaults via column defaults (no explicit `UPDATE` needed) so they present as fresh "new" cards on first visit to the study session — they all have `due = now()` and are immediately reviewable.
- Rollback path: drop `review_logs` table + drop the 10 added columns + drop the new index. No data is lost because `review_logs` is net-new and the 10 columns were not present in any prior code path. Document this in the PR description.

## References

- Research: `context/changes/first-spaced-repetition-session/research.md`
- ts-fsrs API surface: `context/changes/first-spaced-repetition-session/ts-fsrs-api-docs.md`
- Library selection rationale: `context/changes/first-spaced-repetition-session/library-research.md`
- Roadmap slice §S-03: `context/foundation/roadmap.md`
- Auth + envelope pattern: `src/pages/api/cards/generate.ts:24-48`, `src/lib/api/errors.ts:54-59`
- Domain-service precedent: `src/lib/llm/openrouter.ts`
- Routing template: `src/pages/decks/[id].astro`
- Action-bar slot: `src/components/decks/DeckRow.tsx:81-93`
- RLS test template: `supabase/tests/rls_cards_isolation.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + codegen

#### Automated

- [x] 1.1 Migration applies cleanly against a fresh local Supabase: `npx supabase db reset` — fb3640f
- [x] 1.2 TypeScript compiles after codegen refresh: `npm run build` — fb3640f
- [x] 1.3 Lint passes: `npm run lint` — fb3640f
- [x] 1.4 RLS isolation test passes: `psql … -f supabase/tests/rls_review_logs_isolation.sql` — fb3640f

#### Manual

- [x] 1.5 Supabase Studio shows `cards` with 10 new columns + comment, `review_logs` table present with unique constraint, indexes visible, RLS enabled on both tables — fb3640f
- [x] 1.6 Pre-existing card row presents as `state=0`, `due=now()`, all metrics 0 — fb3640f

### Phase 2: Study service module + `ts-fsrs` dependency

#### Automated

- [x] 2.1 Type check passes: `npm run build` — 8a11bf7
- [x] 2.2 Lint passes: `npm run lint` — 8a11bf7
- [x] 2.3 Format clean: `npm run format` — 8a11bf7
- [x] 2.4 `ts-fsrs` resolves at build time (no "Could not resolve" warnings) — 8a11bf7

#### Manual

- [x] 2.5 REPL or API sanity check confirms `getNextDueCard` returns a fresh card and `applyRating` with `Good` advances `due` + increments `reps` — af3f465

### Phase 3: API endpoints

#### Automated

- [x] 3.1 `npm run build` passes (route registration + types) — af3f465
- [x] 3.2 `npm run lint` passes — af3f465
- [x] 3.3 `GET /api/study/next?deckId=<uuid>` curl smoke returns `{ ok: true, card }` or `{ ok: true, card: null }` — af3f465
- [x] 3.4 `POST /api/study/review` curl smoke returns `{ ok: true, next, done }` — af3f465

#### Manual

- [x] 3.5 Replayed `POST /api/study/review` (same body twice within 60s) returns identical response; `review_logs` row count is exactly 1 — af3f465
- [x] 3.6 Rating `Again` advances `due` by minutes; `Good` advances by days — af3f465
- [x] 3.7 `review_at` outside ±60s window returns `REVIEW_CONFLICT` (409) — af3f465
- [x] 3.8 User B hitting user A's `card_id` returns `CARD_NOT_FOUND` (not a DB error) — af3f465

### Phase 4: Study session UI

#### Automated

- [x] 4.1 `npm run build` passes (route present, no import errors)
- [x] 4.2 `npm run lint` passes
- [x] 4.3 `npm run format` clean

#### Manual

- [x] 4.4 Visiting `/study/<deckId>` logged-out redirects to `/auth/signin`
- [x] 4.5 Logged-in user with due cards sees the front
- [x] 4.6 "Show answer" reveals back + 4 buttons; clicking `Good` advances or shows summary
- [x] 4.7 `Space` reveals the back; `1`/`2`/`3`/`4` rate when revealed; keys do nothing on the front
- [x] 4.8 Summary card shows correct rating counts AND the "Come back tomorrow" copy
- [x] 4.9 Empty-deck case renders summary with zero counts + "Nothing due right now" + "Back to deck" link
- [x] 4.10 Mobile viewport (≤375px) keeps the 4 buttons tappable
- [x] 4.11 Retry idempotency: throttle network in devtools to "Offline", click `Good`, the request fails with a retryable Alert; toggle back to "Online", click `Good` again — the request body shows the SAME `review_at` (component retained `pendingReviewAt`), the card advances exactly once, and `review_logs` shows exactly 1 row for that card

### Phase 5: Entry point + smoke pass

#### Automated

- [ ] 5.1 `npm run build` + `npm run lint` + `npm run format` clean
- [ ] 5.2 CI (lint + build) green on the PR

#### Manual

- [ ] 5.3 Golden path: `/decks` → `Study` → front → reveal → rate → next → … → summary (no console errors)
- [ ] 5.4 Returning-day flow: card with `due = now() - 1d` appears on reload
- [ ] 5.5 Idempotency replay: re-sent `POST /api/study/review` produces identical response; `review_logs` count unchanged
- [ ] 5.6 RLS two-user smoke: user B URL-edit to user A's deck returns `DECK_NOT_FOUND` state; `review_logs` SELECT for user B returns 0 rows
- [ ] 5.7 No regressions: dashboard, deck list, paste-to-generate, rename, delete, signout all work
- [ ] 5.8 No production env vars touched (`.dev.vars` and Cloudflare dashboard secrets unchanged)
