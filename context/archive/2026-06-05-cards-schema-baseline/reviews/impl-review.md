<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: cards-schema-baseline (F-01)

- **Plan**: context/changes/cards-schema-baseline/plan.md
- **Mode**: Ad-hoc post-implementation (the `10x-impl-review` skill is not installed in this project; review produced manually following the same shape)
- **Date**: 2026-06-05
- **Verdict**: SOUND with caveats — shipped, with 3 warnings and 2 observations all resolved
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Plan Adherence | WARNING (3 contract drifts) |
| Architectural Fitness | PASS |
| Lean Execution | PASS |
| Verification Quality | WARNING (Phase 5 unverifiable until first PR run) |

## Implementation commits

- Phase 1: `f075649` — cards table + RLS policies migration
- Phase 2: `5e58b01` — typed Supabase client + codegen pipeline
- Phase 3: `a6797ce` — RLS isolation SQL test
- Phase 4: `e48c092` — link + push to hosted Supabase + hosted smoke
- Phase 5: `6c34a0a` — CI types-in-sync guardrail
- Epilogue: `ee8109e` — close out plan (status → implemented)
- Findings-fix: `eba1ab4` — resolve impl-review findings (W1/W2/O1; W3 noted)

## Findings

### W1 — db:test:rls is local-only; plan intended it portable

- **Severity**: WARNING
- **Impact**: MEDIUM
- **Dimension**: Plan Adherence
- **Location**: Phase 3, package.json
- **Detail**: Plan contract (line 225 of original plan) specified `psql "postgresql://...:54322/..." -f ...`. Implementation used `cat ... | docker exec -i supabase_db_10x-astro-starter psql ...` to adapt to "psql not on PATH". This hardcoded the local container name and broke Phase 4 step #3's expectation that the same wrapper could run against `$HOSTED_DB_URL`. Phase 4 workaround was the dashboard SQL editor.
- **Resolution (eba1ab4)**: Added `db:test:rls:linked` using a transient `postgres:17-alpine` container + `$HOSTED_DB_URL`. Updated Phase 3 and Phase 4 plan contracts. Documented in README and runbook.
- **Decision**: FIXED via "Split into local + linked scripts".

### W2 — CI branch mismatch: workflow targets `master`, repo on `main`

- **Severity**: WARNING
- **Impact**: MEDIUM
- **Dimension**: Verification Quality
- **Location**: Phase 5, `.github/workflows/ci.yml:4-6`
- **Detail**: Workflow triggers on push/PR to `master`. Repo HEAD is `main`. The types-in-sync guard added in Phase 5 would never execute. Phase 5 success criterion 5.5 was unobservable as a consequence.
- **Resolution (eba1ab4)**: Changed `branches: [master]` → `branches: [main]` on both `push` and `pull_request` triggers.
- **Decision**: FIXED via "Switch to `main` only".

### W3 — Phase 5 success criteria 5.1–5.3 flipped without verification

- **Severity**: WARNING
- **Impact**: LOW
- **Dimension**: Verification Quality
- **Location**: plan.md Progress § Phase 5 Automated
- **Detail**: 5.1 ("test PR that intentionally edits a migration without regenerating types fails on the new step") required a real CI run that wasn't performed. 5.2 and 5.3 likewise. The Phase 5 commit message acknowledges this: "(final CI behavior to be observed on the next push/PR)". Compounded by W2 — the guard couldn't run anyway.
- **Resolution (eba1ab4)**: Recorded as a follow-up note in `change.md`. First exercise will happen organically on the next push/PR to `main` now that W2 is fixed. If the guard misbehaves, file a follow-up rather than re-open this change.
- **Decision**: DEFERRED — awaits first real PR run, follow-up note in change.md.

### O1 — db:types contract evolved; plan not updated

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Plan Adherence
- **Location**: Phase 2 step #1 contract
- **Detail**: Plan specified `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`. Shipped script appends `&& prettier --write src/db/database.types.ts`; also requires `src/db/database.types.ts` in `eslint.config.js` ignores. Both forced by lint, both sensible — but the plan is a template downstream slices will copy.
- **Resolution (eba1ab4)**: Updated Phase 2 step #1 contract to match shipped reality with a note explaining why the prettier tail and eslint ignore are required.
- **Decision**: FIXED via "Update Phase 2 contract".

### O2 — RLS test script self-cleanup is better than plan

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Lean Execution
- **Location**: `supabase/tests/rls_cards_isolation.sql`
- **Detail**: Plan's Phase 4 step #3 expected manual deletion of synthetic rows after hosted runs. Implementation added a self-cleanup block (deletes `public.cards` rows + `auth.users` rows at the end), making the script idempotent. This is a strict improvement.
- **Resolution**: No change needed. Future template-copiers should preserve this property; called out as such in the updated Phase 4 plan contract (`eba1ab4`).
- **Decision**: ACCEPTED — improvement adopted as the canonical pattern.

## What was sound

- RLS path: cookied SSR client + `Database` generic, no service-role-key shortcut — exactly as planned.
- Scope discipline: no extra columns, no `reviews` table, no `PROTECTED_ROUTES` change, no `config.toml` `project_id` mutation.
- Migration is clean, idempotent, and applies on both local and hosted (4 policies confirmed via `pg_policies`).
- Commit hygiene: 5 phase commits + epilogue, all with proper conventional-commit subjects and `(pN)` suffixes; SHAs written back into every Progress row.
- RLS test correctly adapted to the FK constraint on `auth.users` that the plan's snippet missed.
