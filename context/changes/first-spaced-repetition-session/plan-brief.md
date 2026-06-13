# First Spaced-Repetition Session (S-03) — Plan Brief

> Full plan: `context/changes/first-spaced-repetition-session/plan.md`
> Research: `context/changes/first-spaced-repetition-session/research.md`

## What & Why

Close the learning loop end-to-end (PRD Primary SC). A logged-in user with cards in a deck starts a spaced-repetition session, rates recall on one card at a time, finishes with a summary, and on returning the next day sees due cards again. This is the **north star** roadmap slice — every other slice in the must-have set exists to enable it. Non-Goal-1 says we wrap an existing OSS library: `ts-fsrs@^5.4`.

## Starting Point

`cards` table exists (F-01) with `id, user_id, deck_id, front, back, created_at` and RLS gated on `user_id = auth.uid()`. `decks` table + `DeckRow` UI exist (S-02). API conventions are settled: `{ ok, error: { code, message } }` envelope, `supabase.auth.getUser()` per route, Zod `safeParse` + `classifyZodError`. No FSRS columns, no `review_logs` table, no `src/lib/study/` module, no `/study/*` route, no `ts-fsrs` dependency.

## Desired End State

Per-deck `/study/[deckId]` page where the user clicks "Show answer" (or presses Space), reads the back, then clicks one of 4 labeled rating buttons (Again / Hard / Good / Easy) — or presses `1`–`4` — each annotated with an interval preview ("<10m / <1d / ~3d / ~7d"). When the queue of `due ≤ now()` cards is exhausted, an inline summary card shows reviewed counts + "Back to deck". The next day, the same deck shows due cards again because `cards.due` was advanced by `ts-fsrs`. A "Study" button sits in the `DeckRow` action bar as the entry point. Review writes are idempotent: replaying the same `POST /api/study/review` body returns the same `next` view without double-advancing.

## Key Decisions Made

| Decision                                | Choice                                                                                                  | Why (1 sentence)                                                                                                                                                | Source   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| SR library                              | `ts-fsrs@^5.4`                                                                                          | FSRS-5 (~22% better log-loss than SM-2), zero deps, edge-safe, MIT, 58K weekly downloads.                                                                       | Research |
| State persistence shape                 | Full FSRS Card state on `cards` row + append-only `review_logs`                                         | Algorithm is stateful — minimal event log alone is insufficient for the next `scheduler.next()` call.                                                           | Research |
| Session boundary                        | All due cards reviewed (queue = `due ≤ now()` at session start, ends when empty)                        | Deterministically closes the FSRS loop and the Primary SC; simplest end-condition to explain.                                                                   | Plan     |
| Card flip + rate UX                     | Single-screen reveal: "Show answer" → back + 4 rating buttons appear together                           | Minimum interaction; matches Anki convention; one render state for the rating panel.                                                                            | Plan     |
| Rating UI                               | Labeled buttons (Again/Hard/Good/Easy) + keyboard `1`–`4` + interval-preview subtitles from `repeat()`  | Matches Anki gold-standard UX; gives users the feedback loop FSRS expects; keyboard supports high-volume reviewing.                                             | Plan     |
| End-of-session UI                       | Inline summary card on `/study/[deckId]` with reviewed counts + "Back to deck"                          | Closes the Primary SC loop with a concrete success moment; gives the user something to come back for tomorrow.                                                  | Plan     |
| `state` / `rating` column storage       | `smallint` with a `COMMENT` decoding values                                                             | Matches ts-fsrs JSON integer serialization verbatim (no coercion); cheap to index; doesn't touch the Supabase enum codegen path.                                | Plan     |
| Idempotency mechanism                   | DB-level `UNIQUE(card_id, review) + ON CONFLICT DO NOTHING` + re-read; no client `Idempotency-Key`      | Satisfies Guardrails-2 with zero client coordination; conflict is detected atomically by Postgres.                                                              | Plan     |
| Routing + session scope                 | Per-deck only: `/study/[deckId]`                                                                        | Clones the `[id].astro` template; entry-point semantics map 1:1 to a `DeckRow` button per roadmap §S-03 Parallel-with.                                          | Plan     |
| Entry-point CTA                         | `DeckRow` action bar only (no dashboard CTA)                                                            | Matches roadmap's "deck-list is the deeper user intent"; per-deck route maps cleanly to a per-deck button.                                                      | Plan     |
| FSRS parameter overrides                | Library defaults (`request_retention: 0.9`, `maximum_interval: 36500`, `enable_fuzz: true`)             | Per-user tuning is out of scope for MVP; defaults match Anki's recommended FSRS defaults.                                                                       | Research |
| Production env-var rollout              | None — `ts-fsrs` has no API key                                                                         | Stated explicitly in plan so `/10x-impl-review` doesn't flag the `lessons.md` rule as missing.                                                                  | Research |

## Scope

**In scope:**

- Forward-only migration: 10 FSRS columns on `cards`, new `review_logs` table with idempotency anchor, `cards(user_id, due)` index, RLS on `review_logs`, comments decoding `smallint` enums.
- `supabase/tests/rls_review_logs_isolation.sql` cloned from cards-isolation test.
- `npm install ts-fsrs@^5.4`; `src/lib/study/{service.ts, schemas.ts, types.ts, format.ts}`.
- `GET /api/study/next?deckId=<uuid>` (returns `card: null` when queue empty) and `POST /api/study/review` with one new error code (`REVIEW_CONFLICT`).
- `/study/[deckId]` protected route + `StudySessionPage` React component (`useState`-based, single-screen reveal, 4 buttons, keyboard `1`–`4`, summary card).
- `src/components/ui/card.tsx` shadcn primitive.
- `DeckRow` "Study" button entry point.
- Five-item manual smoke checklist proving Guardrails-2 + Primary SC.

**Out of scope:**

- Cross-deck `/study` global queue, dashboard "Start session" CTA, per-user FSRS parameter tuning, client `Idempotency-Key` header, Postgres enums for `state`/`rating`, precomputed `card_count_due`, Sentry / structured logging beyond `wrangler tail`, test runner introduction, native `nextDueAt` field on summary response (hardcoded "Come back tomorrow" at MVP).

## Architecture / Approach

Layered, single-direction-of-dependency:

```
src/pages/study/[deckId].astro           → React shell
src/components/study/StudySessionPage.tsx → useState state machine
src/pages/api/study/{next,review}.ts     → thin handlers (auth + envelope only)
src/lib/study/service.ts                 → only module importing ts-fsrs
supabase (cards + review_logs + RLS)     → row-state + idempotent log
```

Data flow per review click: component → `POST /api/study/review` with `(card_id, rating, review_at)` → route validates body + window + auth + card ownership → service runs `scheduler.next` → atomically inserts `review_logs` row (`ON CONFLICT DO NOTHING`) and patches `cards` row → service returns next due card via index scan on `cards(user_id, due)` → route envelopes → component advances.

## Phases at a Glance

| Phase                                       | What it delivers                                                                                                | Key risk                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Schema + codegen                         | Migration applied, `review_logs` exists, RLS smoke test passes, `database.types.ts` regenerated                 | RLS policy typo letting user B see user A's logs — mitigated by cloning the proven F-01 pattern + isolation SQL test.   |
| 2. Study service module + `ts-fsrs`         | `ts-fsrs@^5.4` installed; `src/lib/study/` exposes `getNextDueCard`, `applyRating`, `previewIntervals`          | Coupling leakage (handler/UI importing `ts-fsrs` directly) — mitigated by explicit "service is the only importer" rule. |
| 3. API endpoints                            | `GET /api/study/next` + `POST /api/study/review` working; idempotent under replay; empty queue returns `card: null` cleanly | Idempotency failure under retry storm — mitigated by atomic `record_review` rpc + curl replay check.                    |
| 4. Study session UI                         | `/study/[deckId]` shows front → revealed back + 4 buttons → next card → summary; keyboard `1`–`4` works         | Keyboard handler firing on the front (rating without reveal) — mitigated by gating `keydown` on `showAnswer` state.     |
| 5. Entry point + smoke pass                 | `DeckRow` "Study" button; 8-item end-to-end smoke checklist passes; no regressions                              | A regression in deck-management's existing buttons — caught by the dedicated regression-sweep step.                     |

**Prerequisites:** F-01 (done), S-01 (done). S-02 (done) supplies the preferred entry point.
**Estimated effort:** ~3 evenings (1 each for Phase 1+2, Phase 3, Phase 4+5).

## Open Risks & Assumptions

- Assumes `nodejs_compat` + Astro Cloudflare adapter handles `ts-fsrs` ESM without `no_bundle` interference — fallback per `library-research.md` is `@squeakyrobot/fsrs` or `quanta-fsrs`. Risk: low (research confirmed bundle headroom + zero-dep, pure-TS package).
- Hardcoded "Come back tomorrow" on the summary is intentionally weaker than computing the real next-due relative time. If user feedback says it feels generic, a follow-up adds `next_due_at` to the summary response.
- The `±60s review_at` window assumes user clocks are roughly correct; clients with severe clock skew will hit `REVIEW_CONFLICT` and need to retry. Acceptable at MVP because the same constraint enforces idempotency safety.

## Success Criteria (Summary)

- The user clicks `Study` on a deck, completes a session, and sees the summary card with correct counts.
- Returning the next day, cards whose `due` was advanced into the previous day appear in the queue again — verified manually by setting one card's `due = now() - 1d` in Studio.
- Replaying the same `POST /api/study/review` body returns identical response with `review_logs` row count unchanged (Guardrails-2: "never lose progress or show the wrong card").
