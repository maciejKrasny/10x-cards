---
date: 2026-06-22T18:23:24Z
researcher: extern.maciej.stanislaw.krasny
git_commit: 75175d9210fb5bd4d22a181e5a67ff139cd004eb
branch: feature/test-module
repository: maciejKrasny/10x-cards
topic: "Generation-flow contract — LLM payload robustness + env-var rollout gate"
tags: [research, codebase, llm, openrouter, env-vars, cloudflare-workers, vitest, phase-1]
status: complete
last_updated: 2026-06-22
last_updated_by: extern.maciej.stanislaw.krasny
---

# Research: Generation-flow contract — LLM payload robustness + env-var rollout gate

**Date**: 2026-06-22T18:23:24Z
**Researcher**: extern.maciej.stanislaw.krasny
**Git Commit**: 75175d9210fb5bd4d22a181e5a67ff139cd004eb
**Branch**: feature/test-module
**Repository**: maciejKrasny/10x-cards

## Research Question

Ground Risk #1 ("LLM provider returns invalid/corrupted payload — generation flow saves garbage cards, crashes, or hangs the user") and Risk #2 ("a new production-only secret is introduced in code but never set in Workers Secrets — first post-deploy request 502s") from `context/foundation/test-plan.md` in current code so that Phase 1 (`testing-generation-flow-contract`) can plan precise unit + integration tests and a structural CI gate. Phase 1 also bootstraps the JS/TS test runner and the API-edge HTTP mocking layer.

## Summary

The current code already gives Phase 1 a strong, narrow target:

1. **Risk #1 — the LLM client is a single discrete entry point with a clean error taxonomy.** `generateCardsFromText` (`src/lib/llm/openrouter.ts:43`) is the only path from any caller into OpenRouter. It throws exactly four stable error strings (`LLM_NOT_CONFIGURED`, `LLM_HTTP_ERROR`, `LLM_EMPTY_RESPONSE`, `LLM_INVALID_OUTPUT`) at six precise throw sites, uses global `fetch` (so mocking with `vi.spyOn(globalThis, "fetch")` or MSW is straightforward), and `AbortSignal.timeout(45_000)` is the only "hang" guard. Card validation is a discrete, exported Zod schema (`src/lib/llm/schemas.ts:8–13`), unit-testable without touching the route.
2. **Risk #1 — "saves garbage cards" is structurally impossible from `/api/cards/generate` alone.** The route does NOT persist cards; it returns the preview to the client (`generate.ts:56`), which then re-submits via `POST /api/cards/bulk` after explicit user review. The "zero cards persisted on LLM failure" claim must therefore be split into two tests: (a) the generate route must respond `LLM_FAILURE` (502) with no card payload, and (b) the bulk route's single-statement multi-row insert is atomic at the Postgres-statement level (`bulk.ts:57`), so a downstream DB error returns `DB_INSERT_FAILED` with all-or-nothing semantics. The plan should not test a transaction wrapper — none exists, and none is needed for this architecture.
3. **Risk #1 — the route collapses all six LLM error throw-sites to a single `LLM_FAILURE` response code.** `generate.ts:50–54` catches every error from `generateCardsFromText` and returns one error code with no discrimination. **Integration tests can only assert `LLM_FAILURE`/502; the unit tests on the LLM client are the only place the individual codes can be verified.** This is a deliberate UX choice, not a bug — but the plan must allocate the right tests to the right layer.
4. **Risk #2 — every structural gate is missing.** `astro.config.mjs:18–24` declares all four env vars as `optional: true`, so a missing prod secret never fails the build. `.github/workflows/ci.yml` provides only `SUPABASE_URL` / `SUPABASE_KEY` to the build step — never `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`. `wrangler.jsonc` has no `vars` or `secrets` block. No `/api/_health` endpoint exists for a pre-deploy probe. **And the canonical historical proof-point: the `2026-06-05-ai-generate-from-paste` plan that caused the S-01 incident documents the `wrangler secret put` step only in prose — there is no `- [ ]` Progress checkbox, exactly the failure mode `lessons.md` was written to prevent.**
5. **Test-runner bootstrap surface is greenfield.** Zero JS/TS test infra exists. No `vitest`, `jest`, `playwright` in `package.json`; no config files; no test directories. The only existing tests are pure-SQL RLS isolation under `supabase/tests/` invoked via `npm run db:test:rls:*`. Phase 1 picks the runner and mocking edge from a blank slate — `tsconfig.json` path alias `@/*` → `./src/*` must be mirrored in whatever runner is chosen.
6. **UI strings are English, not Polish.** Despite the AGENTS.md convention line, every user-visible error message in the generation flow is English (`api/errors.ts:26–39`, `PasteToGenerate.tsx:10–18`). The only Polish residual is a single starter-template line in `src/lib/config-status.ts:15`. Test assertions on user-visible strings should target English.

## Detailed Findings

### LLM client surface (Risk #1 ground truth)

The OpenRouter call is the only network egress in the generation flow. `src/lib/llm/openrouter.ts:43` exports `generateCardsFromText(text: string): Promise<GeneratedCard[]>`. The function is short (135 lines total, all in one file) and has these properties relevant to testing:

**Throw-site → error-code matrix:**

| Line | Condition | Error string | Test-fixture shape that hits it |
|---|---|---|---|
| `openrouter.ts:44–46` | `!OPENROUTER_API_KEY` truthy guard | `LLM_NOT_CONFIGURED` | Unset env var; production-only failure mode for Risk #2 |
| `openrouter.ts:73–75` | `fetch(...)` throws (network / DNS / abort / timeout) | `LLM_HTTP_ERROR` | Mock fetch to reject, or let `AbortSignal.timeout(45_000)` fire |
| `openrouter.ts:77–97` | `!response.ok` (4xx / 5xx upstream) | `LLM_HTTP_ERROR` | Mock fetch to resolve with `{ status: 429, body: <json-or-text> }` |
| `openrouter.ts:99–104` | `await response.json()` throws on body | `LLM_INVALID_OUTPUT` | Mock fetch to resolve 200 with `text/plain` non-JSON body |
| `openrouter.ts:106–109` | `extractAssistantContent(payload)` returns null | `LLM_EMPTY_RESPONSE` | Mock 200 + `{ choices: [] }` or `{ choices: [{ message: {} }] }` |
| `openrouter.ts:111–116` | `JSON.parse(content)` throws on `message.content` | `LLM_INVALID_OUTPUT` | Mock 200 + `choices[0].message.content = "not json"` |
| `openrouter.ts:118–122` | `GeneratedCardsSchema.safeParse(cardsField)` fails | `LLM_INVALID_OUTPUT` | Mock 200 + content `{"cards":[]}` (empty array), or oversize front, or wrong shape |

Note that **two distinct upstream behaviours land on the same string** (`LLM_HTTP_ERROR`: network exception vs. non-OK response), and **three distinct shapes land on `LLM_INVALID_OUTPUT`** (body parse, content parse, schema violation). Unit tests must exercise each throw site individually; otherwise a regression that moves a throw between sites would pass.

**Discrete unit-testable schema:** `src/lib/llm/schemas.ts:8–13`

```typescript
export const GeneratedCardSchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
});

export const GeneratedCardsSchema = z.array(GeneratedCardSchema).min(1).max(30);
```

`GeneratedCardsSchema` is the oracle for parser unit tests. **The anti-pattern flagged in §2 of the test plan applies here:** do not write fixtures by mirroring what the parser accepts — derive cases from the contract (front/back must be 1–1000 chars; cards array must be 1–30 entries; both are required strings). Counter-examples (empty string, 1001-char string, 31 cards, non-string types, missing field) trace directly to the four `safeParse` failure modes.

**Timeout / hang guard:** `REQUEST_TIMEOUT_MS = 45_000` at `openrouter.ts:6`, applied via `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` at `openrouter.ts:71`. Crossing the timeout surfaces as the `fetch` catch at line 73 → `LLM_HTTP_ERROR`. No retry logic exists at the client; no retry logic exists at the route either. The "hangs the user" failure mode is bounded at 45 seconds by construction.

**No SDK / no internal abstraction.** OpenRouter is called with `globalThis.fetch` directly. This is the cheapest possible mocking surface: a Vitest spy on `globalThis.fetch` or an MSW HTTP intercept on `https://openrouter.ai/api/v1/chat/completions` covers every test case. No need to refactor the client to take an injectable HTTP client.

### Generation flow — split architecture (Risk #1 boundary)

`src/pages/api/cards/generate.ts` is **not** the persistence boundary. The route:

1. Parses + validates body against `GenerateRequestSchema` (`generate.ts:17–20`)
2. Resolves session via `supabase.auth.getUser()` (`generate.ts:28–33`)
3. Verifies deck ownership: `decks.id = deck_id AND user_id = auth.uid()`, returns `DECK_NOT_FOUND` on miss (`generate.ts:39–46`)
4. Calls `generateCardsFromText(text)` (`generate.ts:50–54`) — wraps **every** thrown error from the LLM client in a single `errorResponse("LLM_FAILURE")` (502)
5. Returns the generated cards inline as JSON for the client to review (`generate.ts:56–59`)

Persistence happens later in a separate request to `src/pages/api/cards/bulk.ts`, which the client (`PasteToGenerate.tsx:185–231`) issues only after the user explicitly accepts the review. Inside `bulk.ts`:

- Same auth + deck-ownership preamble (`bulk.ts:17–46`)
- Single multi-row insert at `bulk.ts:57`:
  ```typescript
  await supabase.from("cards").insert(rows).select("id, front, back, created_at");
  ```
- The comment at `bulk.ts:48–49` documents the atomicity guarantee:
  > "Single-statement multi-row INSERT is atomic in Postgres — all rows commit or none do, satisfying the all-or-nothing transaction requirement."
- On error → `DB_INSERT_FAILED` (`bulk.ts:59–61`). No partial-state failure surface exists.

**Implication for the test plan:** Risk #1's "zero cards persisted on garbage payload" decomposes into:
- **Generate-route tests** assert the response body has no `cards` field on every failure mode, and the error code is `LLM_FAILURE` with HTTP 502. These tests do NOT need a DB — mock the LLM fetch and inspect the response.
- **Bulk-route tests** assert the atomicity guarantee separately — but this is properly Phase 2's territory (API ownership + bulk-insert), not Phase 1.

The plan should explicitly **not** add a transaction wrapper or any new abstraction. The architecture already guarantees "review before persist" and "atomic multi-row insert."

### Error-code collapse at the route layer

`generate.ts:50–54`:

```typescript
let generated;
try {
  generated = await generateCardsFromText(text);
} catch {
  return errorResponse("LLM_FAILURE");
}
```

**Every distinct LLM-client throw collapses to one client-facing code.** The route does not preserve or even read the `Error.message`. This is intentional (UX: don't leak provider error detail), but it has direct test-design consequences:

- **Unit layer (LLM client)** is the only place the six throw-sites can be discriminated. Unit tests must cover all of them.
- **Integration layer (generate route)** can only assert `error.code === "LLM_FAILURE"` and HTTP status 502. Five fixtures still belong here (happy / malformed JSON / schema-violating JSON / empty array / network error) because the assertion is "any failure mode produces clean 502 with no cards" — the value is in the breadth, not the discrimination.

`errorResponse` and `ERROR_MESSAGES` for the user-visible error live in `src/lib/api/errors.ts` (`LLM_FAILURE` → 502, user message "Generation failed. Please try again." per `errors.ts:26–39`). The client mirrors this in `src/components/cards/PasteToGenerate.tsx:10–18`.

### Env-var declaration surface (Risk #2 ground truth)

**`astro.config.mjs:17–24`** declares all four env vars as server-side, optional:

```javascript
env: {
  schema: {
    SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
    SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    OPENROUTER_MODEL: envField.string({ context: "server", access: "public", optional: true }),
  },
}
```

`optional: true` is the structural root cause of the S-01 incident: with it set, `npm run build` succeeds even when `OPENROUTER_API_KEY` is unset, so missing-secret deploys are not caught at build time. Removing `optional: true` is not the fix the plan should pursue — local dev needs to work without an OpenRouter key when the user is only touching the auth/middleware surface. The fix is a **structural CI gate** that catches the diff between "env var newly declared / newly read in code" and "Progress checkbox present".

Reads in code:
- `src/lib/llm/openrouter.ts:1, 44, 48` — `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `src/lib/supabase.ts` — `SUPABASE_URL`, `SUPABASE_KEY`
- `src/lib/config-status.ts:1, 14` — Supabase keys for the banner config check

### Wrangler / Cloudflare deployment surface (Risk #2)

`wrangler.jsonc` (project root):

```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "10x-cards",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-05-08",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "directory": "./dist", "not_found_handling": "404-page" },
  "observability": { "enabled": true }
}
```

- **No `vars` block, no `secrets` block.** Secrets must be set via `npx wrangler secret put <NAME>` per environment.
- **`compatibility_flags: ["nodejs_compat"]`** is required for the Astro Cloudflare adapter; relevant to test runner config because `astro:env/server` resolution requires Astro's vite plugin, which Vitest will need to load.
- **No `npm run deploy` script.** Deployment is a documented manual sequence per `context/changes/.../runbook.md` references — no scripted hook for "before deploy, verify all secrets present".

### CI surface (Risk #2)

`.github/workflows/ci.yml` (full file):

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx astro sync
      - run: npm run lint
      - name: Start local Postgres for type generation
        run: npx supabase db start
      - name: Apply migrations and regenerate types
        run: |
          npx supabase db reset --no-seed
          npm run db:types
      - name: Verify generated types are in sync
        run: |
          if ! git diff --exit-code src/db/database.types.ts; then
            echo "::error::src/db/database.types.ts is out of sync with the latest migration."
            exit 1
          fi
      - run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
```

Gaps relevant to Risk #2 and to the typecheck gate listed in test-plan §5:
- **No `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` in the build env.** Build succeeds because env vars are `optional: true`.
- **No `npm test` step.** Phase 1 must add one once the runner lands.
- **No `astro check` step.** Test-plan §5 marks typecheck as `recommended (planned wiring after §3 Phase 1)` — Phase 1's plan should wire it.
- **No structural gate enforcing the `lessons.md` checkbox rule.**

### lessons.md rule — empirical enforcement reality

The rule in `context/foundation/lessons.md:12–17`:

> "When a plan introduces any production-only env var or secret, it MUST add a `- [ ]` checkbox under `## Progress` for 'production secret(s) set in target environment'. Implementation cannot mark the slice complete until that box is ticked."

The rule was written **after** the S-01 incident. Empirical check across all four archived changes:

| Change | Introduces env var(s)? | Required checkbox present? |
|---|---|---|
| `context/archive/2026-06-05-cards-schema-baseline/` | No (DB schema only) | n/a |
| `context/archive/2026-06-05-ai-generate-from-paste/` | **Yes — `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (the S-01 secrets)** | **No — the very plan that caused the incident lacks the checkbox** |
| `context/archive/2026-06-12-deck-management/` | No | n/a |
| `context/archive/2026-06-13-first-spaced-repetition-session/` | No (explicitly states "No production env vars to add") | n/a (acknowledgement-style declaration is a good pattern to emulate) |

This is the strongest possible evidence that prose-only enforcement does not work: the canonical incident has gone un-remediated in its own plan even after the rule existed. **The Phase 1 plan must add a structural gate, not another prose rule.** The gate has two natural shapes (the plan can pick one or combine):

1. **Static check at PR time:** parse the diff for changes to `astro.config.mjs:env.schema` or new reads of `import.meta.env`/`astro:env/server`; if any, require the change-folder's `plan.md` to contain a `- [ ]` line matching `secret(s) set in (Workers Secrets|target environment)` (case-insensitive).
2. **Pre-deploy probe:** add `GET /api/_health` that returns the boolean presence (never the value) of each declared secret and run it as a Wrangler post-deploy step against the just-deployed Workers URL; non-200 or any false → fail the deploy.

Option 1 alone catches the omission earlier (PR review). Option 2 alone closes the loop (production reality). Option 1+2 is the belt-and-braces version; the plan can decide on cost × signal but Option 1 is the cheaper signal-rich move.

### Test-runner bootstrap surface

`package.json` confirms the slate:

- `astro@^6.3.1`, `@astrojs/cloudflare@^13.5.0`, `vite@^7.3.2`, `react@^19.2.6`, `typescript@^5.9.3`, `zod@^4.4.3`, `ts-fsrs@^5.4.1`, `@supabase/supabase-js@^2.99.1`
- `"type": "module"`, Node pinned to `22.14.0` via `.nvmrc`
- Zero test devDependencies: no `vitest`, `jest`, `playwright`, `msw`, `nock`, `undici`, `node-fetch`
- Zero test config files: no `vitest.config.*`, `jest.config.*`, `playwright.config.*`

Existing tests live entirely in `supabase/tests/*.sql`:
- `rls_cards_isolation.sql`, `rls_decks_isolation.sql`, `rls_review_logs_isolation.sql` — run via `npm run db:test:rls:*` (psql / docker), pure SQL, not the model for JS/TS test patterns

**`tsconfig.json` path alias to mirror in the runner:** `"@/*": ["./src/*"]` (`tsconfig.json:9–11`). Anything Vitest-flavored will need `resolve.alias` (in `vitest.config.ts` or a shared `vite.config.ts`) replicating this.

**Module-resolution gotcha for the runner:** the LLM client imports `OPENROUTER_API_KEY` from `astro:env/server` (`openrouter.ts:1`). A vanilla Vitest setup cannot resolve `astro:env/server`. Phase 1's plan must either (a) use Astro's Vite integration (`getViteConfig` from `astro/config`) which wires the env plugin, or (b) configure a Vitest alias mapping `astro:env/server` to a thin shim that re-exports `process.env.*`. Option (a) is the documented Astro pattern; option (b) is leaner but more brittle.

**Mocking edge:** because the only network egress is `globalThis.fetch(ENDPOINT, ...)`, any of these mock at the right point:
- `vi.spyOn(globalThis, "fetch")` — zero extra deps, Vitest-native; simplest fit
- `msw` with a node setup intercepting `https://openrouter.ai/api/v1/chat/completions` — heavier dep, but the canonical choice for HTTP-edge mocking with declarative handlers
- `undici` MockAgent — only relevant if the code switches off `globalThis.fetch`

The plan should choose deliberately under cost × signal; per test-plan §7 ("Test-stack configuration depth"), don't comparison-shop further than picking one.

### User-visible string language reality

`AGENTS.md` says "UI text/error messages in this project use Polish." The memory `feedback_english_ui.md` overrides this with "user wants all UI strings in English." Empirical check:

- `src/lib/api/errors.ts:26–39` — `"Request body is invalid."`, `"Text is too short."`, `"Generation failed. Please try again."`, `"Saving failed. Please try again."` — **English**
- `src/components/cards/PasteToGenerate.tsx:10–18` — `"Please sign in to generate cards."`, `"Generation failed. Please try again."` — **English**
- `src/lib/config-status.ts:15` — `"Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone."` — **Polish (starter template residual)**

Test assertions on user-visible error text should target the English strings shipping today. If the plan touches `config-status.ts`, replacing the Polish residual with English is in-scope as a tiny cleanup but is not required by either risk.

## Code References

- `src/lib/llm/openrouter.ts:43` — `generateCardsFromText(text)` exported entry
- `src/lib/llm/openrouter.ts:6, 71` — `REQUEST_TIMEOUT_MS = 45_000` and its `AbortSignal.timeout` application
- `src/lib/llm/openrouter.ts:44–46, 73–75, 77–97, 99–104, 106–109, 111–116, 118–122` — every error throw site (see matrix above)
- `src/lib/llm/openrouter.ts:127–135` — `extractAssistantContent` helper (drives `LLM_EMPTY_RESPONSE`)
- `src/lib/llm/schemas.ts:8–13` — `GeneratedCardSchema`, `GeneratedCardsSchema` (oracle for unit tests)
- `src/pages/api/cards/generate.ts:50–54` — error-code collapse to `LLM_FAILURE`
- `src/pages/api/cards/generate.ts:56–59` — preview response (no DB write)
- `src/pages/api/cards/bulk.ts:50–57` — atomic multi-row insert
- `src/lib/api/errors.ts:26–39` — full error-code → message → status map
- `src/lib/api/errors.ts:57–62` — `errorResponse(code)` envelope shape
- `src/lib/supabase.ts:6–25` — Supabase SSR client factory (anon key, RLS-respecting)
- `src/middleware.ts:4, 18` — `PROTECTED_ROUTES` array (relevant to Phase 4, not Phase 1)
- `src/components/cards/PasteToGenerate.tsx:117–152, 185–231` — client-side generate→review→submit logic
- `astro.config.mjs:17–24` — `env.schema` declarations (all `optional: true`)
- `wrangler.jsonc` (full file) — no `vars`/`secrets` blocks
- `.github/workflows/ci.yml:30–38` — build step env list (no OpenRouter)
- `supabase/migrations/20260605112924_cards_baseline.sql:3–9, 13–30` — `cards` table + RLS policies
- `supabase/tests/rls_cards_isolation.sql:1–19` — example structure of the existing SQL test layer
- `tsconfig.json:9–11` — path alias to mirror in the test runner
- `.nvmrc` — Node `22.14.0`
- `context/foundation/lessons.md:12–17` — the prose rule whose enforcement is the Phase 1 deliverable

## Architecture Insights

- **The generation flow's "review before persist" architecture is a built-in mitigation for Risk #1's "saves garbage cards" sub-clause.** The LLM call cannot persist; persistence is a deliberate second user action against a separate endpoint with an atomic insert. Tests should not invent a transaction wrapper; the all-or-nothing guarantee already exists at the Postgres-statement level.
- **The LLM client is unusually narrow and discrete.** Single exported function, single fetch call, no SDK, no injectable HTTP client, no retries — all error transitions are explicit `throw new Error("...")` statements in one 135-line file. This is an unusually good test surface compared to typical wrapped-SDK clients; the plan should preserve it rather than introduce abstraction layers "for testability".
- **The route deliberately discards error-code discrimination at the boundary.** Test design must respect this: the LLM client owns the six-way taxonomy, the route owns the 502/LLM_FAILURE contract. Don't try to surface client codes through the route — that would leak provider semantics to the UI.
- **The `env.schema.optional: true` setting is load-bearing for local dev** (developers can work on UI without an OpenRouter key) but is structurally why missing-secret deploys don't fail at build. The plan must catch the gap via a CI gate, not by flipping the optionality.
- **No `/api/_health` exists.** It's a natural shape for the Risk #2 pre-deploy probe (return a per-secret presence boolean, never the value), and it's also a non-trivial addition — the plan should treat it as scope rather than a one-line add.
- **Astro `astro:env/server` import in `openrouter.ts:1` is the binding constraint on test runner choice.** Vanilla Vitest cannot resolve this module. Astro's documented test integration (or a hand-rolled alias shim) is required. This is the single biggest setup decision Phase 1 will make.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-ai-generate-from-paste/` — Originating slice for the entire generation flow (openrouter.ts, generate.ts, bulk.ts, PasteToGenerate.tsx, the two Zod schema files, and the OpenRouter secrets). **The plan here is the proof-point for Risk #2's enforcement failure: it documents the `wrangler secret put` step in prose but has no `- [ ]` Progress checkbox.** Worth re-reading for the agreed scope (review-before-save was added later, in 2026-06-22 commit `84521ec` "feat(generate): review-before-save flow with bulk insert"), and for the original error-code taxonomy.
- `context/archive/2026-06-05-cards-schema-baseline/` — `cards` table baseline plus RLS policies and the `supabase/tests/rls_cards_isolation.sql` pattern. Reference template if Phase 2 adds JS-side ownership tests on top of the SQL layer.
- `context/archive/2026-06-13-first-spaced-repetition-session/` — Notable for the **good practice** in its plan: the env-var section explicitly states "No production env vars to add". An acknowledgement-style declaration like this could be the structural answer to Risk #2 — the CI gate could grep every plan for either a "no env vars" acknowledgement OR a Progress checkbox.
- `context/archive/2026-06-12-deck-management/` — Tangential to Phase 1; introduced no env vars and no LLM-flow changes.

## Related Research

This is the first `research.md` under `context/changes/testing-generation-flow-contract/`. Prior research artifacts in archive folders are slice-specific (auth, deck management, SR session, generation flow MVP) and predate the test-plan rollout sequence; none address the test-runner bootstrap or env-var rollout gate.

## Open Questions

1. **Vitest setup path:** Astro's documented `getViteConfig` integration vs. a hand-rolled `astro:env/server` alias shim — which does the team prefer? Both are viable; `getViteConfig` is canonical and resolves the env import natively, the shim is lighter but more brittle. The plan should pick one with a one-line justification.
2. **Mocking layer:** `vi.spyOn(globalThis, "fetch")` (zero deps, Vitest-native) vs. `msw` (declarative handlers, the canonical choice). Per test-plan §7 "test-stack configuration depth", do not comparison-shop further than picking one — but the plan should pick.
3. **Risk #2 gate shape:** static PR check on plan.md vs. `/api/_health` post-deploy probe vs. both. All three are feasible; the cheapest signal-rich move is the static PR check, but it only catches the omission at PR time, not at deploy time. The plan should commit to one or both and name the implementation point (likely a script under `scripts/` invoked from `ci.yml`).
4. **Where to host the static PR check:** GitHub Actions step that runs a Node script reading `git diff` against `main`, or a TS lint rule, or a custom skill check. The first option is the most idiomatic for this repo (`.github/workflows/ci.yml` already exists, the script lives in TS, no new tooling).
5. **Should `optional: true` stay on the env vars?** Recommendation: yes for `OPENROUTER_API_KEY` and `SUPABASE_KEY`, no need to change. The CI gate replaces the build-time guarantee with a PR-time + deploy-time guarantee, which is both more flexible and more accurate for the multi-environment reality (local dev, CI, prod).
6. **English-vs-Polish cleanup of `config-status.ts:15`:** in-scope opportunistic fix? Or out-of-scope for Phase 1? Recommended: out-of-scope; defer to a separate trivial slice to keep Phase 1 focused on the two risks.
