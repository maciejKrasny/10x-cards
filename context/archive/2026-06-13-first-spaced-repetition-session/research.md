---
date: 2026-06-13
researcher: Claude (claude-opus-4-7)
git_commit: f2e4fc96eb8ae89fe1a341df090ba8dd966f77bd
branch: feature/first-spaced-repetition-session
repository: 10x-cards
topic: "ts-fsrs API docs compatibility with the codebase (S-03 prep)"
tags: [research, codebase, ts-fsrs, spaced-repetition, S-03, first-spaced-repetition-session]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude (claude-opus-4-7)
---

# Research: ts-fsrs API docs compatibility with the codebase (S-03 prep)

**Date**: 2026-06-13
**Researcher**: Claude (claude-opus-4-7)
**Git Commit**: f2e4fc96eb8ae89fe1a341df090ba8dd966f77bd
**Branch**: feature/first-spaced-repetition-session
**Repository**: 10x-cards

## Research Question

Verify the codebase against [`context/changes/first-spaced-repetition-session/ts-fsrs-api-docs.md`](ts-fsrs-api-docs.md) and decide whether the documented `ts-fsrs` API surface is compatible with what's actually in the repo, so we can implement roadmap slice **S-03 — first-spaced-repetition-session** ([roadmap.md §S-03](../../foundation/roadmap.md)).

## Summary

**Verdict: compatible.** The repo's runtime, data layer, API conventions, and UI scaffolding all fit the `ts-fsrs` surface described in [ts-fsrs-api-docs.md](ts-fsrs-api-docs.md) without any architectural friction. The doc is consistent with the wider [library-research.md](library-research.md) selection (ts-fsrs ^5.4, pure TS, zero deps, edge-safe, WASI optimizer not needed for S-03).

Concretely:

- **Cloudflare Workers runtime** is ready as-is — `nodejs_compat` on, `no_bundle: true`, Node 22.14.0 pinned, ample bundle headroom; **no new env vars** required.
- **Schema delta is purely additive** — every one of ts-fsrs's 10 `Card` fields is net-new on the `cards` row, and a `review_logs` table doesn't exist yet. No column rename, no destructive migration. Existing F-01 RLS pattern extends cleanly via a `cards`-join policy.
- **API conventions are already what the doc recommends** — `{ ok, error: { code, message } }` envelope, `supabase.auth.getUser()` per route, Zod `safeParse` + `classifyZodError`, JSON-in/JSON-out — these line up with the doc's "persist-then-acknowledge" recipe.
- **UI scaffolding has natural entry points** — dashboard header, `DeckRow`, plain `useState` state pattern. Shadcn Button/Alert/AlertDialog/Textarea are present; only `Card` primitive would be added.

**Two genuine decisions** the API doc leaves to us — both small, both belong in `/10x-plan`, neither blocks adoption:

1. **`State` / `Rating` column representation** — Postgres enum vs `smallint` vs `text`. The ts-fsrs JSON sample at [ts-fsrs-api-docs.md:70-83](ts-fsrs-api-docs.md) serializes both as integers, which makes `smallint` the lowest-friction choice and avoids touching the Supabase enum codegen path.
2. **Idempotency mechanism for the review-write endpoint** — no precedent in the codebase. Mechanically a `unique(card_id, review_timestamp)` constraint on `review_logs` + `ON CONFLICT DO NOTHING` is enough to satisfy [Guardrails-2](../../foundation/roadmap.md) ("never lose progress or show the wrong card") per the doc's recommendation at [ts-fsrs-api-docs.md:117](ts-fsrs-api-docs.md).

**One caveat to honor when writing the migration**: the doc explicitly marks `ReviewLog.elapsed_days` and `ReviewLog.last_elapsed_days` as DEPRECATED and removed in 6.0.0 ([ts-fsrs-api-docs.md:66](ts-fsrs-api-docs.md)). Don't add columns for them on `review_logs`. `Card.elapsed_days` is still live and must be persisted.

## Detailed Findings

### Runtime / Workers fit

The doc presumes a Node ≥20 environment with no special runtime needs (ts-fsrs is pure TS, zero deps, ESM/CJS/UMD, no WASM). The repo satisfies all of that.

- [wrangler.jsonc](../../../wrangler.jsonc) — `"compatibility_date": "2026-05-08"`, `"compatibility_flags": ["nodejs_compat"]`, `"observability": { "enabled": true }`. Build uses `no_bundle: true` (ideal for ts-fsrs-style pure-TS deps).
- [astro.config.mjs](../../../astro.config.mjs) — adapter `@astrojs/cloudflare` ^13.5.0, `output: "server"`, env schema currently has 4 secrets (Supabase x2, OpenRouter x2). **S-03 adds no env vars** — ts-fsrs has no API key.
- [package.json](../../../package.json) — Node v22.14.0 pinned (`.nvmrc`); Zod ^4.4.3 is present (sufficient for the doc's "runtime-validate before passing external input through" guidance at [ts-fsrs-api-docs.md:101](ts-fsrs-api-docs.md) if per-user FSRS params are ever exposed); `@supabase/ssr` ^0.10.3 + `@supabase/supabase-js` ^2.99.1 already edge-safe.
- No Node-only API usage (`fs`, `path`, `child_process`) found anywhere under `src/`.
- Bundle headroom — `dist/server/` ≈ 2.2 MiB uncompressed; ts-fsrs adds ~10 KiB. Well under the 1 MiB compressed free-tier limit.
- Test runner remains absent (no `vitest.config.*`, no `playwright.config.*`, no `__tests__/`). S-03 will be smoke-tested by hand, per roadmap baseline.

**Per [lessons.md](../../foundation/lessons.md)** ("Production env-var rollout needs a Progress checkbox, not prose") — explicitly N/A for S-03. Document the absence in the plan so the impl-review skill doesn't flag it as missing.

### Schema delta — `cards` + new `review_logs`

The doc says ts-fsrs needs **full Card state** persisted (a minimal event log alone is insufficient because the algorithm is stateful — [ts-fsrs-api-docs.md:34-50](ts-fsrs-api-docs.md)). Current `cards` row carries only domain content, so the delta is purely additive.

Current `cards` table — [supabase/migrations/20260605112924_cards_baseline.sql](../../../supabase/migrations/20260605112924_cards_baseline.sql) + [supabase/migrations/20260612153147_decks_baseline.sql](../../../supabase/migrations/20260612153147_decks_baseline.sql):

| Column       | Type        | Note                                                      |
| ------------ | ----------- | --------------------------------------------------------- |
| `id`         | uuid PK     | `gen_random_uuid()`                                       |
| `user_id`    | uuid        | FK → `auth.users(id)` CASCADE                             |
| `deck_id`    | uuid        | FK → `public.decks(id)` CASCADE (added by S-02 migration) |
| `front`      | text        | CHECK 1..1000                                             |
| `back`       | text        | CHECK 1..1000                                             |
| `created_at` | timestamptz | default `now()`                                           |

No `updated_at` trigger; no enums; no jsonb columns; RLS policies `cards_{select,insert,update,delete}_own` all gated on `user_id = auth.uid()`.

Delta needed for the ts-fsrs `Card` interface ([ts-fsrs-api-docs.md:37-50](ts-fsrs-api-docs.md)):

| ts-fsrs field    | Current column | Proposed addition                           | Rationale                     |
| ---------------- | -------------- | ------------------------------------------- | ----------------------------- |
| `difficulty`     | —              | `difficulty float8 not null default 0`      | FSRS metric                   |
| `due`            | —              | `due timestamptz not null default now()`    | Required for due-cards query  |
| `elapsed_days`   | —              | `elapsed_days integer not null default 0`   | Live (not deprecated on Card) |
| `lapses`         | —              | `lapses integer not null default 0`         |                               |
| `last_review`    | —              | `last_review timestamptz null`              | Nullable for new cards        |
| `learning_steps` | —              | `learning_steps integer not null default 0` |                               |
| `reps`           | —              | `reps integer not null default 0`           |                               |
| `scheduled_days` | —              | `scheduled_days integer not null default 0` |                               |
| `stability`      | —              | `stability float8 not null default 0`       | FSRS metric                   |
| `state`          | —              | `state smallint not null default 0`         | See "Open decision 1" below   |

Backfill: existing rows are all "new" cards (state = `State.New` = 0); defaults above suffice — no explicit UPDATE needed. The doc notes `CardInput` accepts ISO-string `DateInput` ([ts-fsrs-api-docs.md:52](ts-fsrs-api-docs.md)), so Supabase's default `timestamptz → string` codegen round-trip works without coercion.

New `review_logs` table (append-only, per [ts-fsrs-api-docs.md:55-83](ts-fsrs-api-docs.md)):

```
id              uuid PK default gen_random_uuid()
card_id         uuid NOT NULL FK → public.cards(id) ON DELETE CASCADE
user_id         uuid NOT NULL  -- denormalized for cheap RLS
difficulty      float8 NOT NULL
due             timestamptz NOT NULL
learning_steps  integer NOT NULL
rating          smallint NOT NULL   -- 1..4 per Rating enum
review          timestamptz NOT NULL -- when the rating was applied
scheduled_days  integer NOT NULL
stability       float8 NOT NULL
state           smallint NOT NULL
UNIQUE (card_id, review)  -- idempotency anchor; see "Open decision 2"
```

**Do NOT add `elapsed_days` or `last_elapsed_days`** to `review_logs` — both are explicitly deprecated and removed in ts-fsrs 6.0.0 ([ts-fsrs-api-docs.md:66](ts-fsrs-api-docs.md)).

RLS for `review_logs` extends the cards pattern via either denormalized `user_id` (cheaper) or `card_id IN (SELECT id FROM cards WHERE user_id = auth.uid())` (DRY-er). The denormalized variant is simpler and the existing `supabase/tests/rls_cards_isolation.sql` two-user smoke-test pattern can be copied.

Indexes the doc calls for explicitly:

- `cards(user_id, due)` for the SR-session entry point ([ts-fsrs-api-docs.md:111](ts-fsrs-api-docs.md)). Trivial migration.

Codegen — [package.json:13](../../../package.json) script `db:types` (`supabase gen types typescript --local > src/db/database.types.ts && prettier --write …`) is the established path. The generated `Database` import is already wired through [src/lib/supabase.ts:4](../../../src/lib/supabase.ts) and `TablesInsert<"cards">` is used at [src/pages/api/cards/generate.ts:6](../../../src/pages/api/cards/generate.ts). Re-run after the migration; new types appear automatically.

Migration filename will follow the pattern `YYYYMMDDhhmmss_<descriptive>.sql` — e.g. `20260613HHMMSS_fsrs_state_and_review_logs.sql`.

### API conventions — direct fit with the doc's recipe

The doc's recommended persistence model ([ts-fsrs-api-docs.md:117](ts-fsrs-api-docs.md)) — "persist-then-acknowledge with a unique key on `(card_id, review_timestamp)` makes the review-write endpoint idempotent" — maps onto the existing conventions without invention:

- **Auth pattern** — [src/pages/api/cards/generate.ts:24-34](../../../src/pages/api/cards/generate.ts): `createClient(headers, cookies)` → `supabase.auth.getUser()` → `errorResponse("UNAUTHORIZED")` if missing. Reuse verbatim for `GET /api/study/next` and `POST /api/study/review`.
- **Error envelope** — [src/lib/api/errors.ts:54-59](../../../src/lib/api/errors.ts) returns `{ ok: false, error: { code, message } }` with stable codes (12 currently: `INVALID_REQUEST`, `INPUT_TOO_SHORT`, `INPUT_TOO_LONG`, `UNAUTHORIZED`, `DECK_NOT_FOUND`, `CARD_NOT_FOUND`, `LLM_FAILURE`, `DB_INSERT_FAILED`, `DB_QUERY_FAILED`, `DB_UPDATE_FAILED`, `DB_DELETE_FAILED`, `SERVER_MISCONFIGURED`). Adding ones like `NO_DUE_CARDS`, `REVIEW_CONFLICT` follows the same pattern.
- **Validation** — Zod schemas live in `src/lib/<domain>/schemas.ts`. Existing example [src/lib/cards/schemas.ts:10-13](../../../src/lib/cards/schemas.ts). Add `src/lib/study/schemas.ts` for the `POST /api/study/review` body (`card_id: uuid, rating: 1|2|3|4, review_at: ISO-8601`).
- **Service split** — none yet; logic lives in handlers. The doc's stateful API begs for a `src/lib/study/service.ts` module (the LLM module at [src/lib/llm/openrouter.ts](../../../src/lib/llm/openrouter.ts) is the precedent). Wrap `scheduler.next(card, now, rating)` there so handlers stay thin.
- **Idempotency** — net-new. The `UNIQUE (card_id, review)` constraint above + `INSERT … ON CONFLICT DO NOTHING` + re-read pattern is the minimum needed to satisfy Guardrails-2. A client-supplied `Idempotency-Key` header is optional polish, not required for the slice.
- **JSON in / JSON out** — confirmed at [src/pages/api/cards/generate.ts:13](../../../src/pages/api/cards/generate.ts); reuse for the study endpoints.

### UI scaffolding fit

- **Protected route** — [src/middleware.ts:4](../../../src/middleware.ts) currently lists `PROTECTED_ROUTES = ["/dashboard", "/decks"]`. Add `"/study"` (or whatever path the plan picks) before shipping.
- **Entry points** — two acceptable, per the roadmap slice description:
  - **Deck-list entry point** in [src/components/decks/DeckRow.tsx](../../../src/components/decks/DeckRow.tsx) — currently renders Rename + Delete; add a "Study" button in the existing `flex gap-2` action bar. This is the preferred entry per [roadmap.md §S-03 Parallel-with](../../foundation/roadmap.md).
  - **Dashboard fallback** in [src/pages/dashboard.astro](../../../src/pages/dashboard.astro) — header at line ~20 has room for a "Start study session" CTA alongside "View decks →".
- **State pattern** — plain `useState` + `useCallback` (no zustand/jotai/TanStack Query). Sample at [src/components/cards/PasteToGenerate.tsx:40-47](../../../src/components/cards/PasteToGenerate.tsx). Matches the doc's stateless `scheduler.next()` semantics — keep current-card + last-rating in component state, post each review, optimistically advance to the next.
- **Shadcn primitives available** — `Button`, `Alert`, `AlertDialog`, `Textarea`. The session screen would benefit from adding `Card` (for the flip front/back container) and possibly `Progress` (session counter) via the shadcn registry already configured at `components.json`.
- **Routing template** — copy [src/pages/decks/[id].astro](../../../src/pages/decks/[id].astro) for `/study/[deckId].astro`: Layout import + `Astro.params` extraction + cosmic-themed container + `<StudySessionPage client:load />`.
- **i18n** — UI strings are English in practice (the user's auto-memory confirms this overrides the AGENTS.md Polish line). Sub-agent found a stale Polish remnant — `<strong>Uwaga:</strong>` in [src/layouts/Layout.astro:25](../../../src/layouts/Layout.astro) — out of scope for S-03 but worth flagging.

## Code References

- `wrangler.jsonc` — runtime config (`nodejs_compat`, observability, no_bundle)
- `astro.config.mjs` — env schema (no addition needed for S-03)
- `package.json` — Zod 4.4.3 present; `db:types` script wires Supabase codegen
- `supabase/migrations/20260605112924_cards_baseline.sql` — F-01 baseline + RLS pattern to clone
- `supabase/migrations/20260612153147_decks_baseline.sql` — second migration, naming convention reference
- `src/db/database.types.ts:31-65` — current `cards` table generated type shape
- `src/lib/supabase.ts:4-6` — `Database`-typed Supabase client factory
- `src/pages/api/cards/generate.ts:24-34` — canonical auth pattern for JSON API routes
- `src/pages/api/cards/generate.ts:13` — JSON-in pattern
- `src/lib/api/errors.ts:54-59` — error envelope helper + `ErrorCode` union
- `src/lib/cards/schemas.ts:10-13` — Zod schema convention
- `src/lib/llm/openrouter.ts` — precedent for a domain-service module (mirror at `src/lib/study/service.ts`)
- `src/middleware.ts:4` — `PROTECTED_ROUTES` array (add `/study`)
- `src/pages/dashboard.astro` — dashboard CTA insertion point
- `src/components/decks/DeckRow.tsx` — deck-list entry-point insertion point
- `src/components/cards/PasteToGenerate.tsx:40-47` — `useState` pattern to mirror
- `src/pages/decks/[id].astro` — protected-page routing template to clone for `/study/[deckId].astro`

## Architecture Insights

- **No service layer yet** — handler files do their own Supabase work. The doc's stateful FSRS API is the strongest case so far for introducing a thin `src/lib/study/service.ts` (mirroring the LLM module). Doing so in S-03 sets the pattern for future stateful domains.
- **The "full Card state" persistence requirement is well-aligned with Postgres + Supabase codegen** — every ts-fsrs `Card` field is a primitive or `Date`, all map to native Postgres types, no jsonb gymnastics needed. The schema can stay relationally normal.
- **The `(card_id, review)` unique key is doing double duty** — it's both the audit-log natural identity _and_ the idempotency anchor. Picking it instead of a separate `idempotency_key` column avoids inventing a parallel mechanism for a slice that doesn't have one yet.
- **The doc's library-swap note** ([ts-fsrs-api-docs.md:116](ts-fsrs-api-docs.md)) is mostly aspirational at MVP — Card-state columns are FSRS-specific. Keeping the append-only `review_logs` table (with `rating + review` as the portable subset) is the practical hedge. The roadmap's Non-Goal-1 already constrains us not to fight this.

## Historical Context (from prior changes)

- [context/changes/first-spaced-repetition-session/library-research.md](library-research.md) — same change-id, prior step. Selected `ts-fsrs@^5.4` based on FSRS-5 accuracy advantage, edge-fit, MIT, zero deps. The API doc fetched into [ts-fsrs-api-docs.md](ts-fsrs-api-docs.md) is consistent with that selection (no surprises in the surface area).
- [context/archive/2026-06-05-cards-schema-baseline/](../../archive/2026-06-05-cards-schema-baseline/) — F-01 (cards-schema-baseline) established the migration + codegen + RLS pattern this slice extends.
- [context/archive/2026-06-05-ai-generate-from-paste/](../../archive/2026-06-05-ai-generate-from-paste/) — S-01 (ai-generate-from-paste) introduced the JSON API + Zod + error-envelope pattern and the LLM service module that's the model for `src/lib/study/service.ts`.
- [context/archive/2026-06-12-deck-management/](../../archive/2026-06-12-deck-management/) — S-02 (deck-management) added the `decks` table (and the `deck_id` FK on cards) plus `DeckListPage` / `DeckRow`, giving the SR session its preferred entry point.
- [context/foundation/lessons.md](../../foundation/lessons.md) — "Production env-var rollout needs a Progress checkbox" — explicitly N/A for S-03 (no new secrets). Worth a single line in the plan that says so, so impl-review doesn't flag a missing checklist.

## Related Research

- [context/changes/first-spaced-repetition-session/library-research.md](library-research.md) — library selection
- [context/changes/first-spaced-repetition-session/ts-fsrs-api-docs.md](ts-fsrs-api-docs.md) — API surface reference (the doc being verified)

## Open Questions

These are intentionally surfaced for `/10x-plan first-spaced-repetition-session`, not for this research pass.

1. **`State` / `Rating` column representation** — `smallint` (cheapest; matches ts-fsrs JSON integer serialization at [ts-fsrs-api-docs.md:70-83](ts-fsrs-api-docs.md)) vs Postgres `CREATE TYPE` enum (more readable in psql; touches codegen). Recommendation: `smallint` with a `/* New=0, Learning=1, Review=2, Relearning=3 */` comment on the column.
2. **Session UX boundary** — what counts as "session complete": every due card reviewed (open-ended), fixed batch size (e.g., 20), or time-bounded? Roadmap §S-03 lists this as an open unknown.
3. **Where the "Start session" CTA lives at MVP** — deck-list (preferred per the roadmap "Parallel-with" note) vs dashboard header (acceptable fallback). Likely both; deck-list is the deeper user intent and dashboard the discovery surface.
4. **Idempotency mechanism scope** — DB-level `UNIQUE (card_id, review) + ON CONFLICT DO NOTHING` is sufficient; whether to additionally accept a client `Idempotency-Key` header is polish.
5. **FSRS parameter overrides** — MVP uses library defaults ([ts-fsrs-api-docs.md:91](ts-fsrs-api-docs.md)). Per-user tuning is out of scope; if exposed later, a `user_fsrs_params jsonb` on a user-prefs table is the doc-recommended shape ([ts-fsrs-api-docs.md:95-99](ts-fsrs-api-docs.md)).
