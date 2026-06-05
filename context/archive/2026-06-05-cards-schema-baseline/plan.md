# F-01: cards-schema-baseline — Implementation Plan

## Overview

Establish the Supabase migration + typed-codegen pattern in this repo (neither exists today) and ship the first migration: a `cards` table with row-level security that isolates each row to its owning user. Downstream slices (S-01 write, S-02 read/edit/delete, S-03 reviews) follow the pattern set here.

## Current State Analysis

- **`supabase/` is initialized but empty of schema**: `supabase/config.toml` exists, `supabase/migrations/` does not, `db.migrations.schema_paths = []` (`supabase/config.toml:58`). The local stack runs via Docker (README, lines 79-112) but has nothing to apply.
- **Supabase CLI v2.23.4** is already a devDependency (`package.json:53`). No `db:*` npm scripts wired.
- **Supabase client is untyped**: `createServerClient` in `src/lib/supabase.ts:9` has no `Database` generic; queries return `any`.
- **Auth integration carries JWT to Postgres**: `src/middleware.ts:6-12` calls `getUser()` through the cookied SSR client; every request through `createClient(headers, cookies)` reaches Postgres with the user's JWT, which is exactly the path RLS expects (`auth.uid()` resolves the right user).
- **Hosted Supabase project exists**: `adtjatwwrarnbsbiexul.supabase.co` (per `context/changes/deployment/runbook.md:24`). The repo is not yet `supabase link`-ed.
- **CI runs lint + build only** (`.github/workflows/ci.yml`): no DB or types gate.
- **PRD constraints**: FR-010 (named decks) parked → single-deck-per-user. Guardrails-1 (no cross-user visibility) and NFR-2 (pasted text leaves no operator-accessible trace) shape what the schema must — and must NOT — store.

## Desired End State

When F-01 is done:

- `supabase/migrations/<ts>_cards_baseline.sql` exists and applies cleanly via `supabase db reset` against the local Docker stack.
- The `cards` table exists locally AND on `adtjatwwrarnbsbiexul.supabase.co`, with RLS enabled and four policies (`select`, `insert`, `update`, `delete`) gating on `auth.uid() = user_id`.
- `src/db/database.types.ts` is checked in and reflects the table; `src/lib/supabase.ts` returns a `SupabaseClient<Database>`.
- `npm run db:types` regenerates the file from the running local stack.
- `supabase/tests/rls_cards_isolation.sql` exists and, when run against the local stack, passes: simulated user B sees zero of user A's inserts. The same script passes when run against the hosted DB.
- CI fails any PR that mutates the schema without regenerating types (`src/db/database.types.ts` diff after a fresh codegen run).

### Key Discoveries

- **Cookied SSR client is the RLS path** (`src/lib/supabase.ts:9-23`). Downstream slices must continue to use this client (NOT the service-role key) for user-scoped reads/writes — RLS is the access-control gate, not app-layer filters. The plan does not change this client's contract; it only adds a `Database` generic.
- **JWT-claims SQL idiom for RLS testing** is the established way to test Postgres RLS without spinning up two real Supabase auth sessions: `set local role authenticated; set local request.jwt.claims to '{"sub": "<uuid>", "role": "authenticated"}'`. This is what the policy's `auth.uid()` reads inside a transaction.
- **CLI `--local` flag generates types from the running stack** (`supabase gen types typescript --local`); this needs `supabase start` running. README already documents Docker as a prerequisite for the local path (README, line 79).
- **`db.migrations.schema_paths = []`** in `config.toml`: leaving it empty is consistent with versioned-SQL migrations (the declarative-schemas pattern is the alternative, not chosen).

## What We're NOT Doing

- **Not adding `source`, `updated_at`, `deleted_at`, `tags`, or `position` columns.** S-01 and S-02 will add what they actually need in their own migrations. The pattern this slice ships exists precisely so adding columns later is cheap.
- **Not adding `reviews` table.** S-03 owns that.
- **Not changing the existing Supabase client's RLS path** (cookied JWT). No service-role-key code paths added.
- **Not automating hosted `db push` from CI.** Roadmap parks operational CI surface under `top_blocker: capacity`. Manual `supabase db push` from a developer machine is the F-01 path.
- **Not adding a real test runner** (vitest/Playwright). The RLS test is a single `.sql` file invoked by `psql`; no test framework introduced.
- **Not changing `supabase/config.toml` `project_id`** (`"10x-astro-starter"`). It affects only local container names; out of scope.
- **Not modifying `PROTECTED_ROUTES`** in `src/middleware.ts`. No new pages ship in F-01.

## Implementation Approach

Five phases, each independently verifiable. Phases 1-3 are local; Phase 4 propagates to the hosted DB; Phase 5 adds the only CI guardrail. The plan deliberately treats codegen, RLS verification, and CI as separate phases (rather than collapsing them into Phase 1) because each phase produces an artifact downstream slices will inherit — making them visible in their own right helps future agents understand why each piece exists.

## Critical Implementation Details

- **RLS verification idiom** (Phase 3): `set local request.jwt.claims` mutates the JWT Postgres sees for the duration of a transaction. The policy's `auth.uid()` reads `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid`. The test script must `BEGIN`, set claims for user A, `INSERT`, `COMMIT`, then in a new transaction set claims for user B and `SELECT count(*) = 0`. Wrapping both setups in one transaction would let the second `set local` overwrite the first.
- **Cookied client is the only client used for user-scoped data**: do not introduce a `SUPABASE_SERVICE_ROLE_KEY` path. RLS depends on the JWT being present in every request; the existing `createClient(headers, cookies)` already carries it.
- **`supabase db reset` is destructive locally**: it drops and recreates the local database. Anyone running the codegen step loses local seed data. README must say this; the F-01 plan calls it out in Phase 2.

---

## Phase 1: Migration tooling + `cards` schema + RLS

### Overview

Bootstrap the migrations directory via the CLI and write the first migration: `cards` table + RLS + four policies.

### Changes Required:

#### 1. Initialize migrations directory

**File**: `supabase/migrations/<timestamp>_cards_baseline.sql` (CLI generates the timestamp prefix).

**Intent**: Create the canonical migration that establishes the `cards` table, enables RLS, and adds the four per-action policies. This is the file every downstream agent will copy as a template for their own migrations.

**Contract**:
- Table `public.cards`:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `front text not null check (char_length(front) between 1 and 1000)`
  - `back text not null check (char_length(back) between 1 and 1000)`
  - `created_at timestamptz not null default now()`
- Index `idx_cards_user_id` on `(user_id)`.
- `alter table public.cards enable row level security;`
- Four policies, each `to authenticated`, gated on `user_id = auth.uid()`:
  - `cards_select_own` (`for select using (user_id = auth.uid())`)
  - `cards_insert_own` (`for insert with check (user_id = auth.uid())`)
  - `cards_update_own` (`for update using (user_id = auth.uid()) with check (user_id = auth.uid())`)
  - `cards_delete_own` (`for delete using (user_id = auth.uid())`)
- Migration is **created via** `npx supabase migration new cards_baseline` (filename timestamp comes from the CLI; do not hand-author the prefix).

#### 2. Apply locally

**Run**: `npx supabase start` (if not running) → `npx supabase db reset`.

**Intent**: Prove the migration applies cleanly to a fresh database. `db reset` reruns every migration; on the first migration, this is equivalent to applying.

**Contract**: The local Postgres at port 54322 has the `public.cards` table with RLS enabled. `\d cards` in `psql` (or Studio) shows the columns, constraints, and indexes; `select * from pg_policies where tablename = 'cards';` returns four rows.

### Success Criteria

#### Automated Verification

- Migration file exists at `supabase/migrations/*_cards_baseline.sql`.
- `npx supabase db reset` exits 0.
- `npm run lint` passes (no SQL impact, but a sanity check the repo is still clean).

#### Manual Verification

- In Studio (`http://localhost:54323`), the `cards` table is visible under `public`, with the expected columns, constraints, and the four RLS policies.
- A `select` against `cards` as the `anon` role returns an error or zero rows (RLS in effect).

**Implementation Note**: After Phase 1's automated verification passes, pause for manual confirmation that the local schema looks correct in Studio before proceeding to Phase 2.

---

## Phase 2: TypeScript codegen pipeline + typed Supabase client

### Overview

Wire `supabase gen types` into an npm script, write its output to `src/db/database.types.ts`, and apply the `Database` generic to the existing Supabase client.

### Changes Required:

#### 1. Add the codegen script

**File**: `package.json`.

**Intent**: A one-liner the human / agent runs after every migration to keep TypeScript in sync. The script targets the local stack (no cloud dependency).

**Contract**: New entry in `scripts`:

```json
"db:types": "supabase gen types typescript --local > src/db/database.types.ts && prettier --write src/db/database.types.ts"
```

The `prettier --write` tail is required so the generated file has deterministic formatting — without it, the CI types-in-sync diff check (Phase 5) becomes flaky and ESLint flags the file. Also add `src/db/database.types.ts` to `eslint.config.js` ignores: the file is generated, must not be hand-edited, and prettier alone guarantees stable formatting.

#### 2. Generate the types file

**File**: `src/db/database.types.ts` (new directory).

**Intent**: Checked-in, regenerable type definitions for the `public` schema; the source of truth for every typed query downstream slices write.

**Contract**: Generated by `npm run db:types` against a running local stack. Exports `Database`, `Tables<>`, `TablesInsert<>`, `TablesUpdate<>`. Do not hand-edit. The file is regenerated on every schema change.

#### 3. Apply the generic to the SSR client

**File**: `src/lib/supabase.ts`.

**Intent**: Make every query the app issues type-safe against the schema; remove the implicit `any` return.

**Contract**: Import `Database` from `@/db/database.types` and change the `createServerClient` call to `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, { ... })`. No other behavior changes — the cookies plumbing stays identical. The `null` early-return when env vars are missing remains.

#### 4. Document the regen flow

**File**: `README.md` (extend the existing **Supabase Configuration** section).

**Intent**: Tell the next contributor (or agent) how to regenerate types after editing a migration, and warn that `supabase db reset` drops local data.

**Contract**: A short subsection — "Database migrations and types" — listing the four-step loop: `npx supabase migration new <name>` → edit the SQL → `npx supabase db reset` → `npm run db:types`. Calls out the `supabase start` prerequisite, explains that reset must run before local codegen so generated types include the new migration, and repeats the `db reset` data-loss caveat.

### Success Criteria

#### Automated Verification

- `npm run db:types` exits 0 (against a running local stack) and writes a non-empty `src/db/database.types.ts`.
- `npm run build` passes (Astro + TS compile against the new typed client).
- `npm run lint` passes.

#### Manual Verification

- `src/db/database.types.ts` contains a `Database` export with `cards` under `Tables.public`.
- A trial typed query in a scratch route (e.g., `supabase.from('cards').select('front, back')`) shows correct autocomplete and types in the editor.
- README's new subsection reads correctly and a fresh agent could follow it.

**Implementation Note**: Pause after Phase 2's automated verification to confirm the editor experience is what's expected before proceeding to Phase 3.

---

## Phase 3: RLS isolation SQL test

### Overview

Encode the Guardrails-1 invariant — "user B never sees user A's cards" — as a repeatable SQL script that runs against any Postgres carrying the migration.

### Changes Required:

#### 1. Write the isolation test

**File**: `supabase/tests/rls_cards_isolation.sql` (new directory).

**Intent**: Prove that the four RLS policies actually isolate users. Two transactions: one inserts as user A, the next selects as user B and asserts zero rows.

**Contract**: A `psql` script that:
1. Inserts a fresh card for synthetic user A by setting `local request.jwt.claims` to `{"sub": "<uuid-A>", "role": "authenticated"}` inside one transaction.
2. In a separate transaction, sets claims to user B and runs `select count(*) from public.cards where user_id = '<uuid-A>';` — asserts the result is `0` via `\if` + `\echo ERROR` + exit-on-error semantics (or via `do $$ begin assert ...; end $$;`).
3. Repeats the inverse direction (B inserts, A counts zero) as a second check.
4. Exits non-zero on any failure so the wrapping npm script propagates the exit code.

Snippet — non-obvious because the `set local request.jwt.claims` idiom and the assertion shape are not standard knowledge:

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  insert into public.cards (user_id, front, back)
    values ('11111111-1111-1111-1111-111111111111', 'A-front', 'A-back');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
  do $$
    declare leaked int;
  begin
    select count(*) into leaked from public.cards;
    assert leaked = 0, format('RLS leak: user B saw %s of user A''s cards', leaked);
  end $$;
commit;
```

#### 2. Add the npm wrapper

**File**: `package.json`.

**Intent**: Make the test trivial to run; future CI integration becomes one extra step.

**Contract**: Two scripts — one for local, one for the linked hosted project — both invoking the same `.sql` file so assertions stay identical across environments:

```json
"db:test:rls": "cat supabase/tests/rls_cards_isolation.sql | docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1",
"db:test:rls:linked": "cat supabase/tests/rls_cards_isolation.sql | docker run --rm -i postgres:17-alpine psql \"${HOSTED_DB_URL:?HOSTED_DB_URL not set; export it from the Supabase dashboard before running}\" -v ON_ERROR_STOP=1"
```

Both shell out to `psql` via Docker — the local variant `exec`s into the already-running stack container (`supabase_db_<project_id>`), and the linked variant uses a transient `postgres:17-alpine` to avoid requiring a local `psql` install. `HOSTED_DB_URL` is set from the Supabase dashboard → Project Settings → Database; never committed.

#### 3. Document the test in README

**File**: `README.md` (extend the same Database subsection added in Phase 2).

**Intent**: Make the existence of the RLS test discoverable.

**Contract**: One paragraph: what the test asserts, the command to run it, when to re-run it (any migration that touches RLS or adds a new user-scoped table).

### Success Criteria

#### Automated Verification

- `npm run db:test:rls` exits 0 against a fresh `supabase db reset`.
- Deliberately breaking RLS (e.g., temporarily dropping `cards_select_own`) makes `npm run db:test:rls` exit non-zero with the assertion message — confirms the test actually fails when it should. (Then restore the policy.)

#### Manual Verification

- Reading the SQL file, a future agent understands what is being asserted and could extend the file for new tables.
- README mentions the test and the regen-after-policy-change rule.

**Implementation Note**: Phase 3 includes a deliberate-break-and-restore step in manual verification; pause after Phase 3 to confirm the negative case was demonstrated before moving on.

---

## Phase 4: Link + push to hosted Supabase + hosted smoke

### Overview

Apply the migration to `adtjatwwrarnbsbiexul.supabase.co` so the deployed Worker has a schema to talk to, then re-run the isolation test against the hosted DB to confirm policies behave identically.

### Changes Required:

#### 1. Link the repo to the hosted project

**Run**: `npx supabase login` (if not already authenticated) → `npx supabase link --project-ref adtjatwwrarnbsbiexul`.

**Intent**: One-time association so `supabase db push` knows which project to target.

**Contract**: `supabase/.temp/project-ref` (or equivalent CLI state) reflects the project ref. `supabase projects list` shows the project as linked.

#### 2. Push the migration

**Run**: `npx supabase db push`.

**Intent**: Apply `<ts>_cards_baseline.sql` to the hosted Postgres.

**Contract**: The migration appears in the hosted DB's `supabase_migrations.schema_migrations` history. The `public.cards` table exists with the four policies. The push is **manual** (the developer running it confirms the diff before executing); not run from CI.

#### 3. Run the isolation test against the hosted DB

**Run**: `export HOSTED_DB_URL="..."` (from Supabase dashboard → Project Settings → Database) then `npm run db:test:rls:linked`. Equivalent path: paste the `.sql` file into the dashboard SQL editor.

**Intent**: Confirm the policies behave identically on the hosted infra. Catches any subtle config drift between local and hosted.

**Contract**: The test exits 0 against the hosted DB. The script's final `commit;` block deletes its own synthetic rows (both `public.cards` and `auth.users` entries), so no manual cleanup is required and re-runs are idempotent.

#### 4. Extend the deploy runbook

**File**: `context/changes/deployment/runbook.md`.

**Intent**: Future migrations follow a documented hosted-push procedure. The runbook is where ops-style steps live; F-01 adds a "Database migrations" section.

**Contract**: A new section, "Database migrations", with: the link command, the push command, the regen-types reminder, and a one-line cleanup note about test rows if the isolation test leaves any behind. Cross-references `supabase/tests/rls_cards_isolation.sql`.

### Success Criteria

#### Automated Verification

- `supabase migration list` shows the migration as applied on both local and linked.
- `psql "$HOSTED_DB_URL" -c "select count(*) from pg_policies where tablename = 'cards';"` returns `4`.
- `psql "$HOSTED_DB_URL" -f supabase/tests/rls_cards_isolation.sql` exits 0.

#### Manual Verification

- The Supabase dashboard for the hosted project shows the `cards` table with the four RLS policies under Authentication → Policies.
- The deployed Worker (`https://10x-cards.maciej-krasny97.workers.dev`) does NOT regress on auth (signin/signup still work) — the migration is additive, but worth a quick check.
- Any synthetic test rows left in the hosted DB are deleted.

**Implementation Note**: Phase 4 is the only phase that mutates a shared resource (the hosted DB). Pause for explicit confirmation from the human before running `supabase db push`.

---

## Phase 5: CI types-in-sync guardrail

### Overview

Catch the most likely silent regression — a migration lands without regenerating `src/db/database.types.ts` — by failing CI when the regen would produce a diff.

### Changes Required:

#### 1. Extend the CI workflow

**File**: `.github/workflows/ci.yml`.

**Intent**: After lint passes and before `npm run build`, start Supabase, apply migrations, regen types, and fail if `git diff --exit-code src/db/database.types.ts` reports changes. The failure message must tell the contributor exactly how to fix it.

**Contract**: A new step (or steps) that:
- Runs `supabase` CLI inside the Actions runner. The CLI is already a devDependency, so it's available via `npx supabase` after `npm ci`. Action `supabase/setup-cli@v1` is the cleaner path if direct `npx` proves slow; either is acceptable — pick during implementation.
- Executes `npx supabase start` (or `supabase/setup-cli` equivalent), then `npx supabase db reset --no-seed` (no seed file exists), then `npm run db:types`.
- Final step: `git diff --exit-code src/db/database.types.ts` — non-zero exit fails the job.
- The step's `name` is "Verify generated types are in sync" so the failure surface in the GitHub UI is self-describing.
- A `run`-step `echo` precedes the diff check and prints the fix command (`npm run db:types && git add src/db/database.types.ts`) so a confused contributor sees the path forward in the log.

#### 2. Confirm `build` step still works

**File**: same `.github/workflows/ci.yml`.

**Intent**: Make sure the types step is sequenced before the build step (so the build runs against types that match the migrations) and that adding the types step doesn't break the existing `SUPABASE_URL`/`SUPABASE_KEY` env propagation.

**Contract**: The build step's env block is unchanged. The new types step runs after `npm run lint` and before `npm run build`. The job continues to run on `master` push and PRs to `master`.

### Success Criteria

#### Automated Verification

- A test PR that intentionally edits a migration without regenerating types fails on the new step with the documented fix command visible in the log.
- A PR with no migration changes runs the new step and passes (idempotent).
- Total CI time increases by less than ~90 seconds (Docker bootstrap dominates; if it's slower, prefer `supabase/setup-cli@v1` over a full local stack).

#### Manual Verification

- The failing-step message in the GitHub UI clearly tells the contributor to run `npm run db:types`.
- The workflow passes on `main` (or `master` per the existing config) after this slice merges.

**Implementation Note**: Phase 5 modifies a shared GitHub Actions workflow. After local verification (`act` is optional; not currently in the repo), pause for confirmation before merging into the branch that runs CI.

---

## Testing Strategy

### Unit Tests

Not introduced. Roadmap parks the test runner under `top_blocker: capacity`. The RLS SQL test (Phase 3) is the closest thing to an automated test in this slice.

### Integration Tests

`supabase/tests/rls_cards_isolation.sql` is the integration test for this slice: it exercises the real RLS path against a real Postgres.

### Manual Testing Steps

1. After Phase 1: `supabase db reset` → confirm `cards` table + four policies in Studio.
2. After Phase 2: edit a scratch file to import the typed client, confirm autocomplete on `from('cards')`.
3. After Phase 3: temporarily drop `cards_select_own`, run `npm run db:test:rls`, confirm failure with helpful message; restore policy and re-run, confirm pass.
4. After Phase 4: open the hosted Supabase dashboard, confirm `cards` table + policies present; re-run isolation test against hosted DB; delete any synthetic rows.
5. After Phase 5: create a test PR that touches a migration without regenerating types; confirm CI fails on the new step.

## Performance Considerations

`target_scale: data_volume: small` per PRD. The `user_id` btree index handles the only common query shape (`select * from cards where user_id = auth.uid()`). The composite `(user_id, created_at desc)` index was explicitly skipped — re-evaluate via `EXPLAIN` if dashboard list rendering shows latency once S-01 produces real card volumes.

## Migration Notes

No existing data — `cards` table is new. No backfill, no compatibility shim. If F-01 is ever rolled back (unlikely; the table is load-bearing for everything downstream), the rollback is `drop table public.cards cascade` in a new migration; do not delete the original migration file.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01 entry, lines 60-73)
- PRD: `context/foundation/prd.md` (Access Control: line 118-120; Guardrails-1: line 41-42; NFR-2: line 109)
- Existing Supabase client: `src/lib/supabase.ts:1-24`
- Middleware (JWT path): `src/middleware.ts:6-12`
- Hosted project ref: `context/changes/deployment/runbook.md:24`
- CI workflow: `.github/workflows/ci.yml`
- Lessons: `context/foundation/lessons.md` (no lodash — not relevant to this SQL/types slice but re-read each session)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration tooling + `cards` schema + RLS

#### Automated

- [x] 1.1 Migration file exists at `supabase/migrations/*_cards_baseline.sql` — f075649
- [x] 1.2 `npx supabase db reset` exits 0 — f075649
- [x] 1.3 `npm run lint` passes — f075649

#### Manual

- [x] 1.4 Studio shows `cards` table with columns, constraints, and four RLS policies — f075649
- [x] 1.5 `select` against `cards` as `anon` returns error or zero rows — f075649

### Phase 2: TypeScript codegen pipeline + typed Supabase client

#### Automated

- [x] 2.1 `npm run db:types` exits 0 and writes non-empty `src/db/database.types.ts` — 5e58b01
- [x] 2.2 `npm run build` passes against the new typed client — 5e58b01
- [x] 2.3 `npm run lint` passes — 5e58b01

#### Manual

- [x] 2.4 `src/db/database.types.ts` contains `Database` export with `cards` table — 5e58b01
- [x] 2.5 Trial typed query in scratch route shows correct autocomplete in editor — 5e58b01
- [x] 2.6 README subsection on regen flow reads correctly — 5e58b01

### Phase 3: RLS isolation SQL test

#### Automated

- [x] 3.1 `npm run db:test:rls` exits 0 against fresh `supabase db reset` — a6797ce
- [x] 3.2 Deliberately dropping `cards_select_own` makes `npm run db:test:rls` exit non-zero with assertion message; policy then restored — a6797ce

#### Manual

- [x] 3.3 SQL file is readable by a future agent and extensible to new tables — a6797ce
- [x] 3.4 README mentions the test and regen-after-policy-change rule — a6797ce

### Phase 4: Link + push to hosted Supabase + hosted smoke

#### Automated

- [x] 4.1 `supabase migration list` shows migration applied on local and linked — e48c092
- [x] 4.2 Hosted DB has four policies on `cards` (`pg_policies` count = 4) — e48c092
- [x] 4.3 Isolation test exits 0 against hosted DB — e48c092

#### Manual

- [x] 4.4 Supabase dashboard shows `cards` table with four RLS policies — e48c092
- [x] 4.5 Deployed Worker auth flows (signin/signup) still work — e48c092
- [x] 4.6 Any synthetic test rows in hosted DB deleted — e48c092

### Phase 5: CI types-in-sync guardrail

#### Automated

- [x] 5.1 Test PR that edits migration without regenerating types fails on new step with fix command visible — 6c34a0a
- [x] 5.2 PR with no migration changes passes the new step — 6c34a0a
- [x] 5.3 CI time increases by less than ~90 seconds — 6c34a0a

#### Manual

- [x] 5.4 Failing-step message in GitHub UI clearly tells contributor to run `npm run db:types` — 6c34a0a
- [x] 5.5 Workflow passes on `master` after the slice merges — 6c34a0a
