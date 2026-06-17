# F-01: cards-schema-baseline — Plan Brief

> Full plan: `context/changes/cards-schema-baseline/plan.md`

## What & Why

Establish the Supabase migration + typed-codegen pattern in this repo (neither exists today) and ship the first migration: a `cards` table with row-level security isolating each row to its owning user. F-01 is the foundation every downstream MVP slice (S-01 AI generation, S-02 deck management, S-03 spaced repetition) builds on; getting the pattern right here is the biggest lever for the rest of the MVP under `top_blocker: capacity`.

## Starting Point

`supabase/` is initialized (`config.toml` present) but `supabase/migrations/` does not exist. The Supabase CLI is in devDependencies but no `db:*` npm scripts are wired. `src/lib/supabase.ts` returns an untyped `SupabaseClient` via cookied SSR — already the right path for RLS, just missing the `Database` generic. The hosted project at `adtjatwwrarnbsbiexul.supabase.co` is live but not yet `supabase link`-ed.

## Desired End State

A logged-in user (via existing auth) has, in both local and hosted Postgres, a `cards` table with RLS that strictly isolates their rows from other users'. `src/lib/supabase.ts` returns a `SupabaseClient<Database>`. Future agents add a new migration via one CLI command, regenerate types via `npm run db:types`, and trust that CI will fail any drift. Guardrails-1 (no cross-user visibility) is anchored by a checked-in SQL test that proves isolation.

## Key Decisions Made

| Decision              | Choice                                                              | Why (1 sentence)                                                                                                      | Source |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| Migration authoring   | Versioned SQL files via `supabase migration new`                    | Explicit reviewable diffs; trivial pattern for future agents — "write a new file, never edit old ones"                | Plan   |
| Schema columns        | Minimum-viable: `id`, `user_id`, `front`, `back`, `created_at`      | Defer `source`/`updated_at`/etc. to the slices that need them; the migration pattern is the foundation, not the table | Plan   |
| Constraints & indexes | NOT NULL + length CHECK (1..1000) + btree on `user_id`              | Protects against long-paste pathology (S-01 risk) and gives deck-list query a sane plan day one                       | Plan   |
| Codegen pipeline      | Local stack → `src/db/database.types.ts` via `npm run db:types`     | No cloud dependency for dev; deterministic against local migrations; matches README's "no cloud needed" default       | Plan   |
| Hosted propagation    | Link + `supabase db push` as part of F-01                           | Closes the loop — deployed Worker has schema day one; isolation test can run against hosted too                       | Plan   |
| RLS verification gate | Scripted SQL test using `set request.jwt.claims`                    | Repeatable, anchors Guardrails-1 against future schema changes, cheap to add to CI later                              | Plan   |
| CI guardrail          | Types-in-sync check (start Supabase, db reset, regen, fail-on-diff) | Catches the most likely silent regression — migration added without regenerating types                                | Plan   |

## Scope

**In scope:**

- `supabase/migrations/<ts>_cards_baseline.sql` with table, RLS, four policies, length CHECKs, `user_id` index
- `npm run db:types` script + `src/db/database.types.ts`
- Typed `createServerClient<Database>` in `src/lib/supabase.ts`
- `supabase/tests/rls_cards_isolation.sql` + `npm run db:test:rls` wrapper
- `supabase link` + `supabase db push` to the hosted project; runbook entry
- CI types-in-sync gate

**Out of scope:**

- Any column beyond the five named above (`source`, `updated_at`, `deleted_at`, `tags`, `position`)
- `reviews` table (S-03 owns it)
- Service-role-key code paths
- Automating `supabase db push` from CI
- A test runner (vitest / Playwright)
- New UI / API routes / `PROTECTED_ROUTES` changes
- Changing `supabase/config.toml` `project_id`

## Architecture / Approach

Five phases, each independently verifiable. Phases 1-3 are local-only (migration → typed codegen → SQL isolation test). Phase 4 propagates the migration to the hosted Supabase project and re-runs the isolation test there. Phase 5 adds one CI step that catches type drift. The cookied SSR Supabase client stays the only path that touches user-scoped data — RLS is the access-control gate, not app-layer filters.

## Phases at a Glance

| Phase                              | What it delivers                                             | Key risk                                                                            |
| ---------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1. Migration + cards + RLS         | Migration file + locally applied schema with four policies   | RLS policy typo: easy to write `using` without `with check` for insert/update       |
| 2. Codegen pipeline + typed client | `npm run db:types`, `src/db/database.types.ts`, typed client | Codegen requires `supabase start` running; contributors without Docker can't regen  |
| 3. RLS isolation SQL test          | Checked-in SQL test + `npm run db:test:rls`                  | `set local request.jwt.claims` idiom is unfamiliar; test must commit-then-read-back |
| 4. Hosted push + smoke             | Migration applied on hosted DB; same test passes there       | Mutates a shared resource; requires manual gate before `db push`                    |
| 5. CI types-in-sync guardrail      | CI step fails when migrations drift from `database.types.ts` | Adds ~90s of Docker bootstrap to CI; first failure may confuse contributors         |

**Prerequisites:** Docker running locally for codegen + isolation test. Supabase CLI authenticated (`supabase login`) for the hosted-push step. Hosted project ref `adtjatwwrarnbsbiexul` already documented in `runbook.md:24`.

**Estimated effort:** ~1-2 evening sessions across the five phases. Phase 4 needs the user present to authorize the hosted push.

## Open Risks & Assumptions

- **Assumption**: the hosted Supabase project `adtjatwwrarnbsbiexul.supabase.co` is the right target. If a separate "staging" project is wanted, Phase 4 expands.
- **Risk**: the schema is minimum-viable; S-01 and S-02 each add a migration before they ship (one for `source`, one for `updated_at`). The plan accepts this — the foundation is the pattern, not the column set.
- **Risk**: the CI step adds Docker bootstrap time. If it exceeds ~90s, swap the `npx supabase start` approach for the `supabase/setup-cli@v1` action.

## Success Criteria (Summary)

- A logged-in user's cards are invisible to every other authenticated user, verified by a checked-in SQL test that runs against both local and hosted Postgres and exits non-zero if isolation breaks.
- A new contributor / agent can add a column by running `supabase migration new <name>` + editing one SQL file + running `npm run db:types`, with CI catching them if they forget the regen.
- The hosted DB at `adtjatwwrarnbsbiexul.supabase.co` carries the same schema as local; the deployed Worker's auth flows continue to work.
