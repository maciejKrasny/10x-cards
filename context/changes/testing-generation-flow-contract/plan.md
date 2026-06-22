# Generation-flow contract — LLM payload robustness + env-var rollout gate — Implementation Plan

## Overview

Bootstrap the project's first JS/TS test runner (Vitest), ship unit + integration coverage for the OpenRouter generation flow that proves a corrupted LLM payload cannot crash or hang the request and never lands cards in the response body, then wire typecheck + test into CI and add a structural PR-time gate that prevents a new env-var declaration from shipping without an acknowledged `- [ ]` Progress checkbox in some open `plan.md`. This is the first row of `context/foundation/test-plan.md` §3 — every later rollout phase reuses the runner, fixture style, mocking pattern, and CI gate this plan lands.

## Current State Analysis

- **Zero JS/TS test infrastructure exists.** `package.json` has `lint`, `lint:fix`, `format`, `db:test:rls:*` scripts but no `test`, no Vitest, Jest, Playwright, or MSW devDeps, no `vitest.config.*`. The only tests today are pure-SQL RLS isolation under `supabase/tests/` invoked via `npm run db:test:rls:*`.
- **The LLM client is a single discrete entry point.** `src/lib/llm/openrouter.ts:43` exports `generateCardsFromText(text)`. It uses `globalThis.fetch` (`openrouter.ts:54`), bounds the "hang" surface at 45s via `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` (`openrouter.ts:71`), and throws four stable error strings at six distinct sites: `LLM_NOT_CONFIGURED` (`:44–46`), `LLM_HTTP_ERROR` from fetch-throw (`:73–75`) and from non-OK response (`:77–97`), `LLM_INVALID_OUTPUT` from body-parse (`:99–104`), content-parse (`:111–116`), and schema-validation (`:118–122`), and `LLM_EMPTY_RESPONSE` (`:106–109`).
- **The card oracle is a discrete Zod schema.** `src/lib/llm/schemas.ts:8–13` exports `GeneratedCardSchema` and `GeneratedCardsSchema` (array length 1–30, each card's `front` and `back` 1–1000 chars). Already unit-testable without touching the route.
- **The route collapses every LLM throw to one user-facing code.** `src/pages/api/cards/generate.ts:50–54` catches every error from `generateCardsFromText` and returns `errorResponse("LLM_FAILURE")` (502). Integration tests can only assert the 502/`LLM_FAILURE` contract; the six throw sites are discriminable only at the unit layer.
- **Persistence is a separate request.** `generate.ts:56–59` returns the preview inline; cards reach the DB only via `POST /api/cards/bulk` (`src/pages/api/cards/bulk.ts:57`) using a single multi-row INSERT that is atomic at the Postgres-statement level. The "zero cards persisted on garbage payload" risk for the generate endpoint is therefore proved by inspecting the response shape, not by checking the DB.
- **Risk #2 has no structural enforcement.** `astro.config.mjs:17–24` declares all env vars `optional: true` (so `npm run build` succeeds even when secrets are unset); `wrangler.jsonc` has no `vars` or `secrets` block; `.github/workflows/ci.yml` ships only `SUPABASE_URL` / `SUPABASE_KEY` to the build step. `context/foundation/lessons.md:12–17` documents a Progress-checkbox rule, but the canonical S-01 incident plan (`context/archive/2026-06-05-ai-generate-from-paste/plan.md`) documents `wrangler secret put` only in prose — the very plan whose omission caused the incident proves prose is not a gate.
- **`tsconfig.json:9–11` declares `@/*` → `./src/*`.** The test runner must mirror this.
- **`astro:env/server` is the load-bearing setup constraint.** `openrouter.ts:1` imports from it; a vanilla Vitest config cannot resolve the module. Astro's `getViteConfig` is the chosen path.

## Desired End State

When this plan is complete:

- `npm test` runs Vitest against co-located `*.test.ts` files under `src/`.
- `src/lib/llm/openrouter.test.ts` discriminates all six throw sites + happy path; `src/lib/llm/schemas.test.ts` covers `GeneratedCardsSchema` contract counter-examples.
- `src/pages/api/cards/generate.test.ts` proves five distinct LLM failure modes all collapse to HTTP 502 with body `{ ok: false, error: { code: "LLM_FAILURE", ... } }` and **no `cards` field on the response**.
- `.github/workflows/ci.yml` runs `astro check`, `npm test`, and `scripts/check-env-rollout.ts` on every PR; the build step requirements remain unchanged.
- A new PR that diffs `astro.config.mjs`'s `env.schema` or introduces a `from "astro:env/server"` import fails CI unless the open change folder's `plan.md` contains a matching `- [ ]` checkbox or an explicit "no production env vars" acknowledgement under `## Progress`.
- `context/foundation/test-plan.md` §6.1, §6.2, and §6.6 are filled in with location, naming, reference test, and run command.

### Key Discoveries

- LLM client is unusually narrow — single exported function, single fetch site, no SDK. `vi.spyOn(globalThis, "fetch")` covers every test fixture (`src/lib/llm/openrouter.ts:54`).
- Generate route does not persist anything — the "no cards" assertion is purely on the response body, no DB fixtures required (`src/pages/api/cards/generate.ts:56–59`).
- Six error throw sites discriminate at the unit layer; the route is intentionally lossy. Unit + integration must split assertions accordingly (`src/pages/api/cards/generate.ts:50–54`).
- `2026-06-13-first-spaced-repetition-session`'s plan demonstrates the acknowledgement form ("No production env vars to add") that the static check should accept alongside the checkbox form.
- `astro check` is not yet wired anywhere — `package.json` has no `typecheck` script today.

## What We're NOT Doing

- **No persistence-layer / bulk-insert tests.** Atomicity of `/api/cards/bulk` is Phase 2 (`API ownership & inline-edit resilience`) territory.
- **No transaction wrapper, no DB-fixtures harness, no Supabase test client setup.** Generate-route integration tests mock the Supabase module entirely via `vi.mock("@/lib/supabase")`.
- **No `/api/_health` endpoint, no post-deploy probe, no deploy CI workflow.** Risk #2 is closed at PR time only; the deploy-time probe is explicitly deferred per the chosen gate shape.
- **No flipping `optional: true` on env vars.** Local dev needs to work without an OpenRouter key; the PR-time check replaces the would-be build-time guarantee.
- **No MSW, no `fast-check`, no `nock`, no `undici`.** Single `vi.spyOn(globalThis, "fetch")` covers the only network egress.
- **No e2e, no Playwright, no Container API, no visual regression.** Test-plan §7 deliberately excludes these.
- **No coverage thresholds, no parallelisation tuning, no Jest-vs-Vitest comparisons.** Test-plan §7 excludes test-stack configuration depth.
- **No English/Polish cleanup of `src/lib/config-status.ts:15`.** Defer to a separate trivial slice.
- **No new test scripts beyond `test`, `test:watch`, `typecheck`.** Subdir-scoped scripts add maintenance for no signal.
- **No production env vars introduced by this plan.** The acknowledgement form (not the checkbox form) is the correct entry in `## Progress`.

## Implementation Approach

Four phases that build on each other and each end with a runnable verification:

1. **Vitest bootstrap** — minimum viable runner. Prove `astro:env/server` and the `@/*` alias resolve under the test rig before any real test is authored.
2. **LLM client unit tests + Zod contract tests** — discriminated throw-site coverage at the unit layer where the taxonomy is preserved. Cookbook §6.1 lands here.
3. **Generate-route integration tests + CI wiring** — five failure modes collapse to LLM_FAILURE/502 + no cards; CI gains typecheck and npm test steps. Cookbook §6.2 lands here.
4. **Env-var rollout PR-check + cookbook §6.6** — Node script consumes the PR diff and the open change folders, fails when env-surface changes lack acknowledgement, passes otherwise. Self-test against synthetic positive and negative diffs.

The plan deliberately accepts that Phase 1's verification ("smoke test passes") is thin — it exists to de-risk the most fragile decision (Astro env resolution) before Phase 2 invests in real assertions.

## Critical Implementation Details

- **`astro:env/server` resolution.** Vitest cannot resolve this module by default. Phase 1 uses `getViteConfig` from `astro/config` in `vitest.config.ts`. Tests that need to control env-var values use `vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "test-model", SUPABASE_URL: "test-url", SUPABASE_KEY: "test-key" }))` at the top of the file; tests that need to assert `LLM_NOT_CONFIGURED` override per-test with `vi.mocked(...)` or a separate file. This is the one gotcha that the rest of the rollout phases will copy from §6.1 — get the pattern right here.
- **Supabase module mocking in route tests.** `src/pages/api/cards/generate.ts:2` imports `createClient` from `@/lib/supabase`. Route tests stub the whole module via `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => fakeClient) }))` where `fakeClient` exposes `.auth.getUser()` and the deck-ownership chain `.from("decks").select(...).eq(...).eq(...).maybeSingle()`. No real Supabase or Postgres in this phase.
- **Invoking the route handler in tests.** Astro `APIRoute` handlers accept an `APIContext`. Tests construct a synthetic context with `request` (real `Request` object), `cookies` (a stub with `.get`/`.set`), and `locals` (empty for these tests; middleware-injected user is reconstructed in the Supabase stub). No Astro `Container` API needed.
- **The `cards` field absence assertion.** For each failure-mode integration test, after asserting status 502 and `body.error.code === "LLM_FAILURE"`, assert `expect(body).not.toHaveProperty("cards")`. This is the structural form of "zero cards persisted" for this endpoint, since the endpoint never writes to the DB.
- **PR-check trigger surface.** The diff scope that triggers the check is exactly two patterns: any modification to `astro.config.mjs` whose hunk overlaps the `env: { schema: { ... } }` block, OR any added line containing `from "astro:env/server"`. The script does not parse JS — text-scan against `git diff --unified=0` is sufficient and avoids pulling in a TS AST.
- **Acceptable acknowledgement forms in plan.md.** Either a `- [ ]` (or `- [x]`) line under `## Progress` whose text matches `/secret.*(set|put).*(workers|environment|wrangler)/i`, OR an explicit prose line under `## Migration Notes` or `## What We're NOT Doing` matching `/no production env vars (to add|introduced)/i`. The script reads every `context/changes/*/plan.md` (not archive) and passes if any open plan provides either form.

---

## Phase 1: Vitest bootstrap + smoke

### Overview

Install Vitest, configure it to work with Astro's Vite plugin so `astro:env/server` and `@/*` both resolve, add `npm test` / `npm run test:watch`, and ship one tiny passing test that exercises both the Astro env import and the alias to prove the rig.

### Changes Required

#### 1. devDependencies

**File**: `package.json`

**Intent**: Add Vitest to devDependencies so the test runner is available locally and in CI. Do not add coverage tools, fast-check, MSW, or any other test devDep beyond the bare minimum — those add maintenance for no signal at this phase.

**Contract**: Adds `"vitest": "^3.x"` (latest stable major compatible with Vite 7) to `devDependencies`. Adds `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`. Does NOT add a `typecheck` script (that lands in Phase 3 with the CI wiring).

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new)

**Intent**: Compose Vitest's config from Astro's `getViteConfig` so the Astro env plugin and the `@/*` alias resolve inside tests exactly as they do in dev/build.

**Contract**: Default-exports a config produced by `getViteConfig({ test: { ... } })` from `astro/config`. The `test` block sets:
- `environment: "node"` (no jsdom; the route logic and LLM client are pure Node-y)
- `include: ["src/**/*.{test,spec}.ts"]`
- `globals: false` (use explicit `import { describe, it, expect, vi } from "vitest"`)
- `clearMocks: true` (defensive against per-test mock leakage)

#### 3. Smoke test

**File**: `src/lib/llm/schemas.smoke.test.ts` (new, deleted at end of Phase 2 when the real `schemas.test.ts` lands)

**Intent**: Prove the runner can resolve `astro:env/server` (via an indirect import from the LLM module) and the `@/*` alias, and that Vitest discovers files under `src/`. Single trivial test that imports `GeneratedCardsSchema` through the alias and asserts a known-good payload parses.

**Contract**: One Vitest `it(...)` calling `GeneratedCardsSchema.safeParse([{ front: "Q", back: "A" }])` and asserting `.success === true`. Demonstrates that import resolution and Zod both work under the runner.

#### 4. .gitignore touch

**File**: `.gitignore`

**Intent**: Ensure Vitest's cache directory isn't committed.

**Contract**: Append a line `node_modules/.vitest/` if missing. No-op if `node_modules/` already covers it (which it does).

### Success Criteria

#### Automated Verification

- `npm install` succeeds
- `npm test` exits 0 with the smoke test passing
- `npx astro check` still passes (no new type errors from `vitest.config.ts`)
- `npm run lint` still passes (no ESLint complaints about new files)

#### Manual Verification

- `npm run test:watch` starts watch mode and re-runs on save
- A deliberate `expect(false).toBe(true)` inside the smoke test fails the run with a readable diff (proves Vitest reporter is working)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: LLM client + Zod unit tests + cookbook §6.1

### Overview

Author the two unit-test files that own the LLM-flow taxonomy: `openrouter.test.ts` discriminates every throw site, `schemas.test.ts` exercises the Zod contract against counter-examples derived from the contract (not from the parser). Update test-plan §6.1 with the pattern so Phases 2–4 of the test-plan rollout copy it.

### Changes Required

#### 1. LLM client unit tests

**File**: `src/lib/llm/openrouter.test.ts` (new)

**Intent**: Seven Vitest cases that lock the public behavior of `generateCardsFromText`: one happy path returning a valid `GeneratedCard[]`, and six discriminated failure tests each asserting the exact error message string at the right throw site. Fetch is stubbed per-case with `vi.spyOn(globalThis, "fetch")`; env vars are mocked via `vi.mock("astro:env/server", ...)` at the file level, with a per-test override for the `LLM_NOT_CONFIGURED` case (e.g., `vi.doMock` inside that one test, or split into a second file).

**Contract**: One `describe("generateCardsFromText")` block with these `it` cases — names verbatim, in this order:
- `"returns parsed cards on a well-formed OpenRouter response"` — fetch resolves 200 with a valid `choices[0].message.content` JSON containing `{ cards: [{ front, back }] }`; expect the returned array to deep-equal the fixture.
- `"throws LLM_NOT_CONFIGURED when OPENROUTER_API_KEY is missing"` — mock env var to undefined; expect rejection with `Error.message === "LLM_NOT_CONFIGURED"`.
- `"throws LLM_HTTP_ERROR when fetch itself rejects"` — fetch rejects with a generic network Error; expect `LLM_HTTP_ERROR`.
- `"throws LLM_HTTP_ERROR on non-OK response status"` — fetch resolves with `{ ok: false, status: 429, text: () => Promise.resolve("rate limited") }`; expect `LLM_HTTP_ERROR`.
- `"throws LLM_INVALID_OUTPUT when response body is not JSON"` — fetch resolves 200 with `json: () => Promise.reject(new SyntaxError())`; expect `LLM_INVALID_OUTPUT`.
- `"throws LLM_EMPTY_RESPONSE when message content is missing"` — fetch resolves 200 with `{ choices: [] }`; expect `LLM_EMPTY_RESPONSE`.
- `"throws LLM_INVALID_OUTPUT when message content is not JSON"` — fetch resolves 200 with `choices[0].message.content === "not json"`; expect `LLM_INVALID_OUTPUT`.
- `"throws LLM_INVALID_OUTPUT when cards array fails schema validation"` — fetch resolves 200 with `{ cards: [] }` (empty, violates `min(1)`); expect `LLM_INVALID_OUTPUT`.

(Eight cases total: 1 happy + 7 throw scenarios — the schema-validation failure is a third path to `LLM_INVALID_OUTPUT` and deserves its own `it`. The "6 throw sites" in research collapse to seven `it` blocks because `LLM_INVALID_OUTPUT` arises from three distinct sites.)

#### 2. Zod contract unit tests

**File**: `src/lib/llm/schemas.test.ts` (new — replaces the Phase 1 smoke file)

**Intent**: Lock the `GeneratedCardsSchema` contract by exercising counter-examples derived from the contract itself, not from the parser code. Each case names the contract violation, not the parser branch.

**Contract**: One `describe("GeneratedCardsSchema")` block with these `it` cases:
- `"accepts a single valid card"` — `[{ front: "Q", back: "A" }]` parses.
- `"accepts the maximum of 30 cards"` — array of 30 valid cards parses.
- `"rejects an empty array"` — `[]` fails.
- `"rejects more than 30 cards"` — array of 31 valid cards fails.
- `"rejects a card with an empty front"` — `front: ""` fails.
- `"rejects a card with a front over 1000 characters"` — `front: "a".repeat(1001)` fails.
- `"rejects a card missing the back field"` — `[{ front: "Q" }]` fails.
- `"rejects a non-string back field"` — `[{ front: "Q", back: 42 }]` fails.

#### 3. Delete the Phase 1 smoke

**File**: `src/lib/llm/schemas.smoke.test.ts`

**Intent**: Remove the smoke now that `schemas.test.ts` is the real coverage.

**Contract**: Delete the file.

#### 4. Cookbook §6.1

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 1` placeholder under `### 6.1 Adding a unit test` with the concrete pattern future contributors copy.

**Contract**: §6.1 becomes:
- **Location**: `src/<module-or-area>/<unit>.test.ts` co-located with the unit under test.
- **Naming**: `<unit-filename-without-ext>.test.ts`. Discovery is automatic via `vitest.config.ts`'s `include` glob.
- **Reference test**: `src/lib/llm/openrouter.test.ts` (HTTP-edge fetch mocking) and `src/lib/llm/schemas.test.ts` (Zod contract counter-examples).
- **Mocking patterns**: `vi.spyOn(globalThis, "fetch")` for outgoing HTTP; `vi.mock("astro:env/server", () => ({ ... }))` for env-var control.
- **Run locally**: `npm test` (single pass) or `npm run test:watch` (re-runs on change). Scope to one file with `npm test -- src/lib/llm/openrouter.test.ts`.

### Success Criteria

#### Automated Verification

- `npm test` exits 0 with all 8 + 8 = 16 cases passing
- `npm run lint` still passes
- `npx astro check` still passes
- Smoke file `src/lib/llm/schemas.smoke.test.ts` is removed (`git status` shows deletion)

#### Manual Verification

- Briefly mutating `openrouter.ts` to swallow one error (replace one `throw new Error("LLM_INVALID_OUTPUT")` with `throw new Error("WRONG")`) makes exactly one test fail with a readable diff
- Test names in the Vitest reporter output read as user-facing failure scenarios, not as internal branch names
- Cookbook §6.1 is human-readable to a contributor who hasn't seen this plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Generate-route integration tests + CI wiring + cookbook §6.2

### Overview

Author the route-level integration tests that prove the failure-mode-to-response-code contract for `POST /api/cards/generate`, then wire `astro check` and `npm test` into `.github/workflows/ci.yml`. Cookbook §6.2 lands here so Phase 2's API-ownership tests in the test-plan rollout can copy the pattern verbatim.

### Changes Required

#### 1. Generate-route integration tests

**File**: `src/pages/api/cards/generate.test.ts` (new)

**Intent**: Six integration cases that invoke the `POST` handler directly with a synthetic `APIContext`, with `@/lib/supabase` and `globalThis.fetch` stubbed. Every case asserts the response status and the presence/absence of the `cards` field. The shared scaffolding (Supabase fake, request builder) lives at the top of the file — not in a shared module yet, per "don't add abstractions beyond what the task requires"; Phase 2 of the test-plan rollout can extract a fixture module if a second route test calls for it.

**Contract**: One `describe("POST /api/cards/generate")` block. Top-of-file setup:
- `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` with a `beforeEach` that re-installs a fake client exposing `.auth.getUser()` returning `{ data: { user: { id: "user-A" } } }` and a chainable `.from("decks").select().eq().eq().maybeSingle()` returning `{ data: { id: "deck-1" } }`.
- A `buildRequest(body)` helper returning a `new Request("http://test/api/cards/generate", { method: "POST", body: JSON.stringify(body) })` and a corresponding minimal `APIContext` stub (`request`, `cookies: { get: () => null, set: () => {} }`).

The `it` cases — names verbatim:
- `"returns 200 with a non-empty cards array on a well-formed LLM response"` — `vi.spyOn(globalThis, "fetch")` resolves with a valid OpenRouter payload; expect `status === 200`, `body.ok === true`, `body.cards.length >= 1`.
- `"returns 502 LLM_FAILURE with no cards on a network error"` — fetch rejects; expect `status === 502`, `body.ok === false`, `body.error.code === "LLM_FAILURE"`, **`expect(body).not.toHaveProperty("cards")`**.
- `"returns 502 LLM_FAILURE with no cards on a non-OK upstream status"` — fetch resolves with `ok: false, status: 429`; same assertions.
- `"returns 502 LLM_FAILURE with no cards on malformed JSON body"` — fetch resolves 200 with `json: () => Promise.reject(new SyntaxError())`; same assertions.
- `"returns 502 LLM_FAILURE with no cards on a schema-violating empty array"` — fetch resolves 200 with `choices[0].message.content` parsing to `{ cards: [] }`; same assertions.
- `"returns 502 LLM_FAILURE with no cards on missing message content"` — fetch resolves 200 with `{ choices: [] }`; same assertions.

#### 2. typecheck script

**File**: `package.json`

**Intent**: Expose `astro check` as `npm run typecheck` so CI invokes it via a stable script name and contributors can run it locally with the same command.

**Contract**: Add `"typecheck": "astro check"` to `scripts`. No other script changes.

#### 3. CI workflow wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Add typecheck and test steps to the existing `ci` job after `npm run lint` and before `npm run build`. Order matters: typecheck before tests (cheaper signal first); tests before build (build is the most expensive step). Neither new step needs production env vars.

**Contract**: Two new steps inserted between `- run: npm run lint` and `- name: Start local Postgres for type generation`:
```
- run: npm run typecheck
- run: npm test
```
No env block on these steps — `optional: true` in `astro.config.mjs` means tests run with all four env vars absent, and tests that need values mock them via `vi.mock("astro:env/server", ...)`.

#### 4. Cookbook §6.2

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 1` placeholder under `### 6.2 Adding an integration test for an API endpoint` with the concrete pattern.

**Contract**: §6.2 becomes:
- **Location**: `src/pages/api/<area>/<endpoint>.test.ts` co-located with the route file.
- **Naming**: `<route-filename-without-ext>.test.ts`.
- **Reference test**: `src/pages/api/cards/generate.test.ts`.
- **Mocking patterns**: `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` to stub the Supabase client (per-test `beforeEach` re-installs the fake); `vi.spyOn(globalThis, "fetch")` for outgoing HTTP. Build the `APIContext` inline; no Astro `Container` API required.
- **Assertion shape**: status + body shape (`ok`, `error.code`, presence/absence of payload fields). Do not assert on `error.message` — those strings are user-facing and may legitimately change.
- **Run locally**: `npm test`. Scope to one file with `npm test -- src/pages/api/cards/generate.test.ts`.

### Success Criteria

#### Automated Verification

- `npm test` exits 0 with all 6 + 16 = 22 cases passing
- `npm run typecheck` exits 0
- `npm run lint` still passes
- CI run on the open PR shows the new `npm run typecheck` and `npm test` steps green
- `git diff context/foundation/test-plan.md` shows the §6.2 update; no other section is touched

#### Manual Verification

- Reading `generate.test.ts` top-to-bottom, a contributor unfamiliar with the project could write a second route's integration test by copying the shape
- The CI badge / Actions tab confirms the workflow ran the new steps in the expected order
- Cookbook §6.2 is human-readable to a contributor who hasn't seen this plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Env-var rollout PR-check + cookbook §6.6

### Overview

Ship the structural gate that prevents another S-01: a Node script invoked from CI that scans the PR diff for env-surface changes and requires a matching acknowledgement in some open `plan.md`. Self-tested against synthetic positive and negative diffs. Cookbook §6.6 lands here so Phase 4 of the test-plan rollout (the page-route ↔ `PROTECTED_ROUTES` parity check) inherits the structural-check pattern.

### Changes Required

#### 1. Env-rollout check script

**File**: `scripts/check-env-rollout.ts` (new)

**Intent**: Detect whether the PR's diff touches the env-var surface, and if so require some open `context/changes/*/plan.md` to acknowledge the rollout. Exit 0 when no env-surface diff exists OR when the acknowledgement is present; exit 1 with a readable message otherwise. Use Node 22 native APIs and `child_process` for `git`; no new devDependencies.

**Contract**:
- Resolves the base ref: prefer `process.env.GITHUB_BASE_REF` (CI), fall back to `origin/main`. The actual diff command is `git diff --unified=0 <base>...HEAD`.
- The env-surface trigger is satisfied by EITHER (a) any added/changed line inside `astro.config.mjs` that lies within the `env: { schema: { ... } }` block, detected by reading the diff hunks and the file content, OR (b) any added line in any file matching `/^\+.*from\s+["']astro:env\/server["']/`.
- When the trigger fires, the script reads every `context/changes/*/plan.md` (NOT `context/archive/`) and accepts if any one of them contains either:
  - a line matching `/^\s*- \[[ x]\]\s+.*secret.*(set|put).*(workers|environment|wrangler)/i` under the `## Progress` section, OR
  - a line matching `/no production env vars (to add|introduced)/i` anywhere in the body.
- On failure, prints: "Env-var rollout gate: the PR touches env declarations/usage but no open plan.md under context/changes/ contains the required Progress checkbox OR an explicit 'no production env vars' acknowledgement. See context/foundation/lessons.md (Production env-var rollout)."
- Exit 0 (no-op) when the env surface is untouched.
- Invokable as `npx tsx scripts/check-env-rollout.ts` or `node --experimental-strip-types scripts/check-env-rollout.ts`.

#### 2. tsx devDependency for script execution

**File**: `package.json`

**Intent**: Provide a stable, fast TypeScript runner for the check script. `tsx` is the minimum necessary; we do not adopt `ts-node`.

**Contract**: Add `"tsx": "^4.x"` to `devDependencies`. Add `"check:env-rollout": "tsx scripts/check-env-rollout.ts"` to `scripts`.

#### 3. CI workflow wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Run the env-rollout check on every PR before the build step. Place it after `npm run lint` but before `npm run typecheck` so the cheapest structural signal fires first.

**Contract**: Add one step between `- run: npm run lint` and `- run: npm run typecheck`:
```
- name: Env-var rollout gate
  if: github.event_name == 'pull_request'
  run: npm run check:env-rollout
```
The `if` guard skips the check on direct pushes to `main` (where there is no diff context).

#### 4. Self-test of the gate

**File**: none (verification only; not committed)

**Intent**: Prove the script fires correctly on a synthetic positive diff and stays silent on the negative diff that this PR actually produces.

**Contract**: Two verification runs documented in the Implementation Note below — one synthetic, one real. Not a permanent test file; this is a one-shot verification.

#### 5. Acknowledgement of "no env vars" for this plan

**File**: `context/changes/testing-generation-flow-contract/plan.md` (this file)

**Intent**: This plan introduces no production env vars. Per the lessons.md rule's escape hatch (the acknowledgement form), this section under `## Migration Notes` makes that explicit so the check script passes on this very PR.

**Contract**: A line under `## Migration Notes` reading "No production env vars introduced by this plan." Already present in the body below — Phase 4 just confirms it survives any final edits.

#### 6. Cookbook §6.6

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 4` placeholder under `### 6.6 Adding a structural / parity check` with the concrete pattern. Future structural checks (e.g., `PROTECTED_ROUTES` parity in test-plan §3 Phase 4) reuse this layout.

**Contract**: §6.6 becomes:
- **Location**: `scripts/check-<concern>.ts`.
- **Naming**: `check-<concern>` for the script and the npm script (`npm run check:<concern>`).
- **Reference**: `scripts/check-env-rollout.ts`.
- **Pattern**: read the PR diff via `git diff --unified=0 <base>...HEAD`; detect the trigger condition by text-matching against the diff (do not parse JS/TS — too brittle); on trigger, scan the relevant on-disk artifacts (e.g., `context/changes/*/plan.md`) and exit 1 with a readable message when the acknowledgement is missing.
- **Run locally**: `npm run check:<concern>`. Locally, the script falls back to `origin/main` as the base ref; in CI it uses `GITHUB_BASE_REF`.

### Success Criteria

#### Automated Verification

- `npm install` succeeds (tsx resolves)
- `npm run check:env-rollout` exits 0 against this PR's actual diff (the plan's acknowledgement satisfies the gate)
- A locally-constructed synthetic diff that adds `OPENROUTER_NEW_KEY: envField.string(...)` to `astro.config.mjs` without an acknowledged plan exits 1 with the documented error message
- `npm test`, `npm run typecheck`, `npm run lint` all still pass
- CI run on the open PR shows the env-rollout step green

#### Manual Verification

- The error message printed on failure is actionable: a contributor reading it knows exactly which file to edit
- Running `npm run check:env-rollout` after temporarily editing `astro.config.mjs` to add a new envField produces the expected failure, and reverting it produces a pass — demonstrating the gate's correctness
- Cookbook §6.6 reads as a recipe a contributor can follow without re-deriving the diff-scanning approach

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful. Then mark the test-plan §3 Phase 1 row `complete` and run `/10x-test-plan` to advance to Phase 2.

---

## Testing Strategy

### Unit Tests

- **LLM client throw-site discrimination.** Each of the six throw sites in `openrouter.ts` gets one `it` (with `LLM_INVALID_OUTPUT` splitting into three because three distinct sites raise it).
- **Zod schema contract.** `GeneratedCardsSchema` is tested against counter-examples derived from the contract bounds (1–30 cards; 1–1000-char front/back; required string types).
- **No mocking of internal modules.** Mocks live only at the HTTP edge (`globalThis.fetch`) and the Astro env import (`astro:env/server`).

### Integration Tests

- **Generate route, six failure modes + happy.** Each case asserts status, `ok`, `error.code` (or `body.cards`), and explicitly the absence of `cards` on failures.
- **Supabase is stubbed wholesale.** No DB or migration setup; the deck-ownership check returns a positive result deterministically.

### Manual Testing Steps

1. Run `npm test` locally — confirm 22 tests pass, no warnings.
2. Add a deliberate `throw new Error("CHANGED")` at one of the openrouter throw sites — confirm exactly one unit test fails with a readable diff. Revert.
3. In `generate.ts`, temporarily change `errorResponse("LLM_FAILURE")` to `errorResponse("INVALID_REQUEST")` for the LLM-catch branch — confirm the relevant integration tests fail. Revert.
4. Add a new `envField` line to `astro.config.mjs` — confirm `npm run check:env-rollout` exits 1 with the documented message; remove the new envField — confirm it exits 0.
5. Push to PR; confirm the GitHub Actions run shows new `Env-var rollout gate`, `npm run typecheck`, and `npm test` steps in order, all green.

## Performance Considerations

- Vitest cold-start under `getViteConfig` is ~1–2s on a warm cache. Acceptable for a 22-test suite. If runtime ever exceeds ~5s with this rollout's tests, revisit the runner config — but not before; per test-plan §7 we don't pre-tune.
- The env-rollout check runs a single `git diff` plus filesystem reads of at most a few `plan.md` files. Sub-second in practice.

## Migration Notes

- **No production env vars introduced by this plan.** The PR-check script's acknowledgement-form rule applies — see the line under `## Progress`.
- No DB migration. No schema change. No data backfill.
- Vitest config and devDependencies will live on the `feature/test-module` branch alongside the other in-flight work; the merge order to `main` is per the team's normal flow.

## References

- Related research: `context/changes/testing-generation-flow-contract/research.md`
- Test-plan rollout phase row: `context/foundation/test-plan.md` §3 Phase 1
- Risk-response guidance: `context/foundation/test-plan.md` §2 Risk #1, Risk #2
- Lessons.md rule: `context/foundation/lessons.md` "Production env-var rollout needs a Progress checkbox, not prose"
- Incident proof-point plan: `context/archive/2026-06-05-ai-generate-from-paste/plan.md` (prose-only, no checkbox — the canonical example the static check is designed to prevent)
- Acknowledgement-form precedent: `context/archive/2026-06-13-first-spaced-repetition-session/plan.md` ("No production env vars to add")
- LLM client source: `src/lib/llm/openrouter.ts`
- LLM Zod schemas: `src/lib/llm/schemas.ts`
- Generate route: `src/pages/api/cards/generate.ts`
- Bulk insert (out of scope, but referenced): `src/pages/api/cards/bulk.ts:48–57`
- Current CI: `.github/workflows/ci.yml`
- Path alias source of truth: `tsconfig.json:9–11`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Rollout acknowledgements

- [ ] 0.1 No production env vars introduced by this plan (acknowledgement-form per lessons.md)

### Phase 1: Vitest bootstrap + smoke

#### Automated

- [x] 1.1 `npm install` succeeds — 52700fe
- [x] 1.2 `npm test` exits 0 with the smoke test passing — 52700fe
- [x] 1.3 `npx astro check` still passes — 52700fe
- [x] 1.4 `npm run lint` still passes — 52700fe

#### Manual

- [x] 1.5 `npm run test:watch` starts watch mode and re-runs on save — 52700fe
- [x] 1.6 A deliberate failing assertion produces a readable diff in the Vitest reporter — 52700fe

### Phase 2: LLM client + Zod unit tests + cookbook §6.1

#### Automated

- [x] 2.1 `npm test` exits 0 with all 8 + 8 = 16 cases passing — f876e9e
- [x] 2.2 `npm run lint` still passes — f876e9e
- [x] 2.3 `npx astro check` still passes — f876e9e
- [x] 2.4 Smoke file `src/lib/llm/schemas.smoke.test.ts` is removed — f876e9e

#### Manual

- [x] 2.5 Mutating one throw site in `openrouter.ts` makes exactly one test fail with a readable diff — f876e9e
- [x] 2.6 Test names read as user-facing failure scenarios, not internal branch names — f876e9e
- [x] 2.7 Cookbook §6.1 is human-readable to a contributor unfamiliar with this plan — f876e9e

### Phase 3: Generate-route integration tests + CI wiring + cookbook §6.2

#### Automated

- [x] 3.1 `npm test` exits 0 with all 6 + 16 = 22 cases passing
- [x] 3.2 `npm run typecheck` exits 0
- [x] 3.3 `npm run lint` still passes
- [x] 3.4 CI run shows new `npm run typecheck` and `npm test` steps green
- [x] 3.5 `git diff context/foundation/test-plan.md` shows only the §6.2 update

#### Manual

- [x] 3.6 A contributor can copy the shape of `generate.test.ts` to write a second route's integration test
- [x] 3.7 GitHub Actions tab confirms the workflow ran the new steps in the expected order
- [x] 3.8 Cookbook §6.2 is human-readable to a contributor unfamiliar with this plan

### Phase 4: Env-var rollout PR-check + cookbook §6.6

#### Automated

- [ ] 4.1 `npm install` succeeds (tsx resolves)
- [ ] 4.2 `npm run check:env-rollout` exits 0 against this PR's actual diff
- [ ] 4.3 A synthetic diff adding an envField without an acknowledged plan exits 1 with the documented message
- [ ] 4.4 `npm test`, `npm run typecheck`, `npm run lint` all still pass
- [ ] 4.5 CI run shows the env-rollout step green

#### Manual

- [ ] 4.6 The failure message is actionable — a contributor knows which file to edit
- [ ] 4.7 Toggling `astro.config.mjs` to add then revert an envField produces fail then pass locally
- [ ] 4.8 Cookbook §6.6 reads as a recipe without re-deriving the diff-scanning approach
- [ ] 4.9 Mark test-plan §3 Phase 1 row `complete` and run `/10x-test-plan` to advance
