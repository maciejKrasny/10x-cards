# Generation-flow contract — Plan Brief

> Full plan: `context/changes/testing-generation-flow-contract/plan.md`
> Research: `context/changes/testing-generation-flow-contract/research.md`

## What & Why

Bootstrap the project's first JS/TS test runner (Vitest) and use it to prove two failure modes that this codebase has already hit in production: a corrupted/empty/timed-out OpenRouter response must produce a clean error response with zero cards in the body, and a new production-only env var cannot ship without an acknowledged rollout step. The Risk #2 incident already happened once — `OPENROUTER_API_KEY` was declared in code but never set in Workers Secrets, 502-ing real users on first paste. The Risk #1 surface has no test coverage at all today. This plan closes both via the cheapest tests that produce real signal and one structural CI gate.

## Starting Point

Zero JS/TS tests exist (only pure-SQL RLS isolation under `supabase/tests/`). The LLM flow is unusually narrow: a single discrete entry point at `src/lib/llm/openrouter.ts:43` with global `fetch`, six discriminated error throw sites, and a discrete Zod oracle (`src/lib/llm/schemas.ts:8–13`). The route does NOT persist cards — persistence happens later via `POST /api/cards/bulk` (atomic Postgres multi-row INSERT). All four env vars are declared `optional: true` in `astro.config.mjs:17–24`; `.github/workflows/ci.yml` ships only Supabase vars to the build; the S-01 incident plan documents `wrangler secret put` in prose only — no `- [ ]` checkbox.

## Desired End State

`npm test` runs Vitest across co-located `*.test.ts` files. Eight unit tests in `src/lib/llm/openrouter.test.ts` discriminate every throw site; eight in `schemas.test.ts` exercise the Zod contract. Six integration tests in `src/pages/api/cards/generate.test.ts` prove five distinct LLM failure modes all collapse to HTTP 502 + `LLM_FAILURE` + no `cards` field. CI runs `astro check`, `npm test`, and `scripts/check-env-rollout.ts` on every PR; a diff that touches `astro.config.mjs:env.schema` or adds an `astro:env/server` import fails CI unless some open `plan.md` acknowledges the rollout. Cookbook §6.1 / §6.2 / §6.6 in `context/foundation/test-plan.md` are filled in with location, naming, reference test, and run command.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Test runner setup | Vitest via Astro's `getViteConfig` | Native `astro:env/server` resolution + alias inheritance; canonical Astro 6+ pattern | Plan |
| HTTP mocking layer | `vi.spyOn(globalThis, "fetch")` | Single egress site; zero extra deps; matches the "no abstractions beyond task" lesson | Plan |
| Risk #2 gate shape | PR-time static check only | Catches the omission at PR review (earliest signal); no `/api/_health` and no deploy workflow needed to scope Phase 1 | Plan |
| Unit-test granularity | One test per throw site (8 client + 8 schema) | The route deliberately collapses LLM error codes — discrimination is only possible at unit layer | Plan |
| Test file layout | Co-located `*.test.ts` next to source | Vitest default discovery; easiest navigation; single cookbook §6.1 rule | Plan |
| Static-check trigger | Diff-triggered only (touches env surface) | Surgical scope; doesn't penalize unrelated PRs; cheap to run | Plan |
| LLM client error catalog | Four stable strings at six throw sites | Already exists at `openrouter.ts:43–125` — preserve, don't refactor | Research |
| "Zero cards persisted" oracle | Response-body absence of `cards` field | Generate route never writes to DB; bulk insert (atomic) is Phase 2 territory | Research |
| Polish→English string cleanup | Out of scope | Defer to a separate trivial slice | Research |
| `optional: true` on env vars | Keep | Local dev needs to work without OpenRouter key; PR-time check replaces build-time guarantee | Research |

## Scope

**In scope:**
- Vitest config via `getViteConfig`, `npm test` / `npm run test:watch`, smoke test
- `src/lib/llm/openrouter.test.ts` — 8 unit cases (happy + 7 throw scenarios discriminating all 6 sites)
- `src/lib/llm/schemas.test.ts` — 8 Zod contract counter-examples
- `src/pages/api/cards/generate.test.ts` — 6 integration cases (happy + 5 failure modes)
- `npm run typecheck` (= `astro check`) wired into CI
- `npm test` wired into CI
- `scripts/check-env-rollout.ts` + CI step + `tsx` devDep
- Cookbook updates to `context/foundation/test-plan.md` §6.1, §6.2, §6.6

**Out of scope:**
- Bulk-insert atomicity tests (Phase 2 of the test-plan rollout)
- DB-fixture harness, real Supabase test client, Astro `Container` API
- `/api/_health` endpoint, post-deploy probe, deploy CI workflow
- MSW, `fast-check`, `nock`, `undici`, coverage thresholds, parallelisation tuning
- e2e, Playwright, visual regression, accessibility tests
- Polish→English cleanup of `src/lib/config-status.ts:15`
- Any new production env vars

## Architecture / Approach

Four sequential phases, each ending with a runnable verification:

```
Phase 1: vitest.config.ts (getViteConfig) + npm test + smoke
   ↓
Phase 2: openrouter.test.ts (8 cases) + schemas.test.ts (8 cases) + cookbook §6.1
   ↓
Phase 3: generate.test.ts (6 cases) + ci.yml gains typecheck + test steps + cookbook §6.2
   ↓
Phase 4: scripts/check-env-rollout.ts + ci.yml gains env-rollout step + cookbook §6.6
```

Tests mock at exactly two surfaces: `globalThis.fetch` (for OpenRouter) and `vi.mock("astro:env/server", ...)` (for env-var control). Route integration tests additionally `vi.mock("@/lib/supabase", ...)` to stub the auth + deck-ownership chain. No DB, no real network, no Astro Container API.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Vitest bootstrap + smoke | `npm test` works; Astro env + `@/*` alias resolve under the runner | `getViteConfig` is the load-bearing decision — if it doesn't resolve `astro:env/server`, Phase 2 falls over |
| 2. LLM client + Zod unit tests + cookbook §6.1 | 16 unit tests discriminate every throw site and Zod contract counter-example | `vi.mock("astro:env/server")` overrides interacting awkwardly with per-test `LLM_NOT_CONFIGURED` case |
| 3. Generate-route integration + CI wiring + cookbook §6.2 | 22 tests total; `astro check` + `npm test` in CI | Supabase module stub needs a chainable shape that the route's actual call sequence matches |
| 4. Env-rollout PR check + cookbook §6.6 | CI fails when env surface changes lack an acknowledged plan | Diff-scope detection across multi-file `astro.config.mjs` edits — text-scan must catch the right hunks |

**Prerequisites:** `feature/test-module` branch checked out, Node `22.14.0` (`.nvmrc`), `npm ci` clean. No new infrastructure (Cloudflare, Supabase) needed.

**Estimated effort:** ~2–3 sessions across 4 phases. Phases 1 and 4 are small; Phases 2 and 3 carry the bulk of the test authoring.

## Open Risks & Assumptions

- **Assumption:** `getViteConfig` from `astro/config` in Astro 6.3.1 still exposes the env plugin used at dev/build time. If the API has shifted, Phase 1's smoke catches it before Phase 2 commits to the pattern.
- **Assumption:** Vitest 3.x is compatible with Vite 7.x. Verified via Vitest's release notes (Vite 7 supported since Vitest 2.1.x); using `^3` keeps us on the current major.
- **Risk:** The diff-triggered env-rollout check has a known escape hatch — a contributor who splits the env-var declaration and the change-folder creation across two PRs can avoid the gate on either PR individually. Accepted: catches the dominant single-PR failure mode (the actual S-01 shape); the multi-PR variant is an explicit follow-up to revisit if it occurs.
- **Risk:** The `vi.mock("@/lib/supabase", ...)` chain stubs must exactly match the call sequence in `generate.ts`. If a later refactor reorders the calls, the integration tests need updating — acceptable cost for not standing up a real Supabase test client.

## Success Criteria (Summary)

- `npm test` passes locally and in CI with 22 tests covering Risk #1's failure modes at the unit and integration layers.
- A PR that introduces a new env var without an acknowledged rollout in some open `plan.md` fails CI with an actionable error message.
- Cookbook §6.1 / §6.2 / §6.6 of `context/foundation/test-plan.md` are populated so the next three rollout phases inherit the pattern without re-deriving it.
