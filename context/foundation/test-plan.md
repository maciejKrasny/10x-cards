# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-22

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the risk wins. Do not promote to e2e because e2e "feels safer." Do not put a vision model on top of a deterministic visual diff that already catches the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team is worried about X, and the failure would surface somewhere in `<area>`" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what could fail* and *why we believe it's likely* — drawn from documents, interview, and codebase *signal* (churn, structure, test base). It does NOT claim to know which line owns the failure. That knowledge is produced by `/10x-research` during each rollout phase. If the plan and research disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding `dist/`, `.wrangler/`, `node_modules/`, `context/`). 46 commits in the last 30 days.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by risk = impact × likelihood. Risks are failure scenarios in user / business terms, not test names. The Source column cites the *evidence that surfaced this risk* — never a specific file as "where the failure lives" (that is research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | LLM provider returns invalid/corrupted payload (malformed JSON, schema-violating output, truncated/partial response, upstream error masquerading as success), and the paste-to-cards endpoint either saves garbage cards, crashes, or hangs the user. | High | High | interview Q1; hot-spot dir `src/lib/llm/` (5 commits/30d); hot-spot dir `src/pages/api/` (18 commits/30d); `context/foundation/lessons.md` — S-01 LLM_FAILURE incident |
| 2 | A new production-only secret is introduced in code but never set in Workers Secrets, so the first post-deploy request 502s for real users. | High | Medium | `context/foundation/lessons.md` — production env-var rollout rule (real S-01 incident: `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` missing on first prod paste) |
| 3 | IDOR / cross-user data leak through the cards/decks/review_logs API surface: route trusts the path-param identity instead of re-verifying ownership against `auth.uid()`, exposing another user's deck. (Abuse lens) | High | Medium | PRD Guardrails-1; PRD §Access Control; hot-spot dir `src/pages/api/` (18 commits/30d); DB-layer RLS tested in `supabase/tests/` but API layer untested |
| 4 | SR review session loses today's progress mid-session, persists a stale review, or surfaces the wrong next-due card — violating PRD Guardrails-2. | High | Medium | PRD Guardrails-2; `context/foundation/infrastructure.md` risk register ("SR session loses progress under request failure"); hot-spot dir `src/lib/study/` (6 commits/30d) |
| 5 | Card edit/delete inline-flow loses typed input on save failure (reverts to display mode), or persists stale state under racing requests. | Medium | Medium | `context/foundation/lessons.md` — inline-edit error-feedback rule (already burned once); interview Q3 + Q4 (deck management high-churn + bare); hot-spot dir `src/components/cards/` (11 commits/30d) |
| 6 | A new authenticated route ships without being added to `PROTECTED_ROUTES`, leaving gated content reachable when logged out — violating PRD §Access Control. (Abuse lens) | High | Medium | PRD §Access Control; hot-spot dir `src/` — `middleware.ts` (4 commits/30d); roadmap S-04 (auth-prd-compliance) is `ready` and will touch this surface |

**Excluded with reason** — *Authenticated user loops giant pastes and exhausts OpenRouter budget / Workers CPU + subrequest caps*: scored High-impact × Low-likelihood given small user base, and `context/foundation/infrastructure.md` already mitigates via Workers Standard plan, batched inserts, and a card-count cap. Belongs in observability/alerting, not a test layer.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A malformed/truncated/empty LLM response is rejected with a clean user-visible error and **zero cards persisted**; the happy path still produces ≥1 valid card. | "OpenRouter `json_schema` mode guarantees usable output." Schema-mode still returns parseable JSON that violates *our* downstream contract (empty array, oversize fields, encoded HTML). | OpenRouter response shape; project's Zod schema for cards; the transactional/atomicity guarantee around "parse → bulk insert"; the current stable error codes (`LLM_HTTP_ERROR`, `LLM_EMPTY_RESPONSE`, `LLM_INVALID_OUTPUT`, `LLM_NOT_CONFIGURED`). | Unit (schema parsing) + integration (API route with mocked LLM fixtures: happy, malformed JSON, schema-violating JSON, empty array, network error). | Oracle problem — deriving the expected output by reading the parser; snapshot of the LLM response; happy-path-only with mocked "perfect" payloads. |
| #2 | A deploy that introduces a new secret cannot ship without that secret being set in Workers Secrets — caught by a structural gate (Progress checkbox enforced) or a pre-deploy probe of `/api/_health` (or equivalent) against the new endpoint. | "The Progress checklist is enough." It is the intent; the gate is what catches the miss. | Current deploy command surface (`wrangler deploy`, `wrangler secret list`); how the existing rule from `lessons.md` is (or isn't) enforced by planning skills. | Structural CI check + runbook entry. Wires into Phase 4 gates rather than a unit/integration test. | Trusting prose in `plan.md` as a gate; assuming `wrangler deploy` fails loudly on a missing secret (it doesn't — it fails at first request). |
| #3 | A request authenticated as user-A targeting a card/deck/review owned by user-B receives 404 or 403, never the payload, regardless of RLS being on or off. Behavior is identical across reading and mutating routes. | "RLS at the DB layer is enough." API routes can bypass with `service_role` or with aggregate/path-param queries that the RLS policy can't see. | Every cards/decks/review_logs API handler; which Supabase client (anon vs service_role) each route uses; how each route resolves the resource (`auth.uid()` filter vs path-param trust). | Integration (two-user fixture, request user-A's session against user-B's resource IDs across every mutating + reading route). | Happy-path-only; testing only one representative route; reusing the same client whose RLS already enforces the boundary. |
| #4 | A review-write that fails halfway leaves DB state unchanged; a retried review-write does not double-count; the next-due query returns the card ts-fsrs says is due, not the one the wrapper *thought* it scheduled. | "Final HTTP 200 means the review persisted correctly." Idempotency depends on the write path, not the response status. | Schema of `review_logs`; the ts-fsrs `Card` ↔ DB-row mapping; the rating-to-state translation; the current next-due query. | Integration (review-write endpoint with failure injection) + contract test (ts-fsrs wrapper input/output with the oracle taken from ts-fsrs library docs/examples — NOT the wrapper code). | Mirror-testing the implementation's rating mapping; happy-path-only ("good rating moves card to next interval" without testing failure persistence). |
| #5 | When the server returns 4xx/5xx on save, the row stays in edit mode with the typed input intact and an error message is shown; on a racing double-submit, the second submit dedupes or is rejected — it does not silently overwrite. | "Optimistic UI is fine because failures are rare." The whole risk is what happens when the failure occurs. | The inline-edit component's state machine; the save endpoint's error contract; where the toast/error-banner state lives. | Component test (React Testing Library) on the inline-edit row with a mocked save action returning 500 / network error. | Snapshot tests of the row markup; happy-path-only with no failure injection. |
| #6 | A logged-out request to any route under known authenticated namespaces (e.g., `/decks`, `/study`, future S-04 surfaces) returns a 302 to `/auth/signin`, derived mechanically — not by hand-maintained route lists. | "Adding the route to `PROTECTED_ROUTES` is a developer-discipline gate." Discipline isn't a gate — a mechanical parity check is. | The current `PROTECTED_ROUTES` array; the page-route layout (which folders are gated); how middleware translates path to redirect. | Structural parity check (discovered page routes under known-protected namespaces vs `PROTECTED_ROUTES`) + one representative smoke integration test per namespace. | Testing the redirect on every page route (slow, brittle); manually maintaining a redirect-test list that rots immediately. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Generation-flow contract | Prove paste-to-cards cannot save garbage cards or crash on any LLM-response failure mode; bootstrap the JS/TS test runner; close the env-var rollout gap. | #1, #2 | unit + integration + CI gate | change opened | `context/changes/testing-generation-flow-contract/` |
| 2 | API ownership & inline-edit resilience | Prove every cards/decks/review_logs API route scopes on `auth.uid()` not path-param trust; prove inline-edit preserves user input on failure. | #3, #5 | integration + component | not started | — |
| 3 | SR session integrity | Prove review writes are idempotent and the ts-fsrs wrapper schedules the card the library says is due — Primary SC + Guardrails-2 protection. | #4 | integration + contract | not started | — |
| 4 | Auth gating parity + CI gate wiring | Prove no authenticated route ships without `PROTECTED_ROUTES` coverage; wire required gates (typecheck, unit+integration) into CI. | #6 | structural parity + CI gates | not started | — |

**Status vocabulary** (parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a `checked:` date so future readers can see which lines need re-verification. Recommendations are grounded in local manifests/configs plus the MCP/tools actually exposed in the current session.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration (JS/TS) | none yet — see §3 Phase 1 | — | likely Vitest, given Astro 6 + Vite 7 already in `package.json`; phase 1 picks the runner |
| API mocking (HTTP edge) | none yet — see §3 Phase 1 | — | mock OpenRouter at the network edge only; never mock internal modules |
| DB-layer isolation tests | `supabase/tests/rls_*_isolation.sql` via psql/docker | n/a | already in place for `cards`, `decks`, `review_logs`; run via `npm run db:test:rls:*` |
| component | none yet — see §3 Phase 2 | — | React Testing Library is the likely fit for inline-edit error paths |
| contract (library wrapper) | none yet — see §3 Phase 3 | — | oracle for ts-fsrs wrapper comes from ts-fsrs docs, not from the wrapper code itself |
| e2e | not adopted | — | excluded by §7; revisit only if a multi-route critical-flow regression emerges |
| accessibility | not adopted | — | excluded by §7 (UI look-and-feel); revisit if a real a11y incident occurs |
| (optional) AI-native | none — excluded under cost × signal per §7 | — | reintroduce via `--refresh` only if a future risk justifies it |

**Stack grounding tools (current session):**
- Docs: Context7 (`mcp__context7__query-docs`) — available, use for current Vitest/Astro/Supabase JS test setup before Phase 1; checked: 2026-06-22
- Search: Exa.ai (`mcp__exa__web_search_exa`) — available, use to verify current ts-fsrs API and Supabase test-client patterns at the moment of research; checked: 2026-06-22
- Runtime/browser: none — no Playwright MCP exposed in this session; checked: 2026-06-22
- Provider/platform: linear-server MCP — available but not test-gate relevant for this rollout; checked: 2026-06-22

Use docs MCPs for current framework/library APIs and setup details. Use search MCPs for discovery or current status only, then prefer official docs as the evidence. Do not use MCP docs/search to infer code failure anchors; those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production. "Required after §3 Phase N" means the gate is enforced once that rollout phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint (ESLint) | local (pre-commit via Husky + lint-staged) + CI | required | syntactic / style drift |
| typecheck (`astro check`) | local + CI | recommended (planned wiring after §3 Phase 1) | type drift |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions in generation flow, API ownership, SR write path |
| DB-layer RLS isolation | manual (`npm run db:test:rls:*`) | recommended (planned: lifted to CI after §3 Phase 2) | per-user data leak at the DB layer |
| production env-var presence check | CI on PR + pre-deploy | required after §3 Phase 1 | new secret introduced in code but not set in Workers Secrets (Risk #2) |
| auth-route parity check | CI on PR | required after §3 Phase 4 | new authenticated route missing from `PROTECTED_ROUTES` (Risk #6) |
| e2e on critical flows | not wired | not required | excluded per §7 (over-investment in infra) |
| post-edit hook | not wired | not required | configured in a later lesson of this module, not by this rollout |
| visual diff / multimodal review | not wired | not required | excluded per §7 (UI look-and-feel) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the relevant rollout phase ships; before that, the sub-section reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: `src/<module-or-area>/<unit>.test.ts` co-located with the unit under test.
- **Naming**: `<unit-filename-without-ext>.test.ts`. Discovery is automatic via `vitest.config.ts`'s `include` glob (`src/**/*.{test,spec}.ts`).
- **Reference test**: `src/lib/llm/openrouter.test.ts` (HTTP-edge fetch mocking) and `src/lib/llm/schemas.test.ts` (Zod contract counter-examples).
- **Mocking patterns**: `vi.spyOn(globalThis, "fetch")` for outgoing HTTP; `vi.mock("astro:env/server", () => ({ ... }))` for env-var control. For per-test env overrides (e.g., asserting an "env missing" branch), use `vi.resetModules()` + `vi.doMock("astro:env/server", ...)` + dynamic `import()`, then `vi.doUnmock("astro:env/server")` at end of the test.
- **Run locally**: `npm test` (single pass) or `npm run test:watch` (re-runs on change). Scope to one file with `npm test -- src/lib/llm/openrouter.test.ts`.

### 6.2 Adding an integration test for an API endpoint

- TBD — see §3 Phase 1 (paste-to-cards endpoint with mocked LLM fixtures) and §3 Phase 2 (two-user IDOR matrix across cards/decks/review_logs).

### 6.3 Adding a component test (React inline edit / error path)

- TBD — see §3 Phase 2 (inline-edit-on-server-error pattern; respects `lessons.md` rule that the row must stay in edit mode on failure).

### 6.4 Adding a contract test for a wrapped external library

- TBD — see §3 Phase 3 (ts-fsrs wrapper contract; oracle taken from ts-fsrs library docs, never from the wrapper itself).

### 6.5 Adding a DB-layer RLS isolation test

- **Location**: `supabase/tests/rls_<table>_isolation.sql`.
- **Reference test**: `supabase/tests/rls_cards_isolation.sql`.
- **Run locally**: `npm run db:test:rls:<table>` (local Supabase) or `npm run db:test:rls:<table>:linked` (against `HOSTED_DB_URL`).
- **When to add**: every new domain table with per-user data. Required for any table that joins to `auth.users` or carries a `user_id` column.

### 6.6 Adding a structural / parity check

- TBD — see §3 Phase 4 (page-route ↔ `PROTECTED_ROUTES` parity; production env-var presence parity).

### 6.7 Per-rollout-phase notes

(Empty on first generation. After each phase lands, `/10x-implement`'s final sub-phase appends a 2–3 line note here capturing anything surprising the rollout phase taught — e.g., fixture layout, runner config gotchas, MSW vs Worker-binding decisions.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future contributors should respect these unless the underlying assumption changes.

- **UI look-and-feel (visual regression, Tailwind class snapshots, screenshot diffs).** Break constantly, catch nothing useful for this project. Re-evaluate if a real visual regression hits a paying user. (Source: interview Q5.)
- **Test-stack configuration depth.** Phase 1 wires the minimum runner + mocking edge needed for the rollout; do not invest further in Jest-vs-Vitest comparisons, test parallelisation tuning, or coverage-threshold gating. Re-evaluate if the runner itself becomes the bottleneck. (Source: interview Q5.)
- **Infrastructure-side over-investment.** No browser farms, no e2e parallelisation, no MCP wiring for test orchestration. Re-evaluate if a regression slips through that only a full deployed environment could catch. (Source: interview Q5.)
- **The ts-fsrs algorithm itself.** External library with its own suite (PRD Non-Goal-1: no custom SR algorithm). Test only our wrapper integration, with the oracle from the library docs. (Source: §1 principle #1.)
- **Vendor primitives in `src/components/ui/`.** Shadcn-generated code is not ours to defend. Re-evaluate if we fork a primitive locally. (Source: §1 principle #1.)
- **Supabase Auth's own flows.** Supabase tests its own auth; we own the middleware redirect contract. Risk #6 covers what we own. (Source: §1 principle #1.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-22
- Stack versions last verified: 2026-06-22
- AI-native tool references last verified: 2026-06-22

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
