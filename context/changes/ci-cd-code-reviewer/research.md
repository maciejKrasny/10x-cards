---
date: 2026-07-15T12:00:00+02:00
researcher: Claude (Opus 4.7)
git_commit: 1e98d66812bbf149e52015efa35d55cacb0e6e1b
branch: main
repository: maciejKrasny/10x-cards
topic: "CI/CD AI code reviewer — composite action + packages/code-reviewer via Vercel AI SDK"
tags: [research, ci-cd, github-actions, ai-sdk, code-review, monorepo-bootstrap]
status: complete
last_updated: 2026-07-15
last_updated_by: Claude (Opus 4.7)
---

# Research: CI/CD AI Code Reviewer

**Date**: 2026-07-15T12:00:00+02:00
**Researcher**: Claude (Opus 4.7)
**Git Commit**: 1e98d66812bbf149e52015efa35d55cacb0e6e1b
**Branch**: main
**Repository**: [maciejKrasny/10x-cards](https://github.com/maciejKrasny/10x-cards)

## Research Question

Build an AI-driven code reviewer that runs on every PR to `main`, scores the change against six criteria (1–10 each), posts a PR comment, and applies `ai-cr:passed`/`ai-cr:failed` labels — with on-demand retry via an `ai-cr:review` label. The reviewer lives in a new `packages/code-reviewer` (Node/TS, Vercel AI SDK) and is invoked from a GHA composite action. See [`requirements.md`](./requirements.md).

## Summary

The repo has zero prior art for this: no composite actions today, no `packages/` directory, no AI SDK, no monorepo tooling. Every piece has to be introduced in this change. Good news — the pre-conditions are simple:

- **CI is already Node 22 + `npm ci` on PR to `main`** ([`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml)) — the new workflow slots alongside it without touching the existing pipeline.
- **Zod 4.4.3 is already a dep** (`package.json:50`) — the review schema uses the same version, no version-alignment concerns.
- **Root ESLint (flat config) + Prettier + Husky/lint-staged auto-cover `packages/**/*.{ts,tsx}`** — no per-package hook setup needed.
- **The repo pattern for LLM env is `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` via `astro:env/server`** ([`src/lib/llm/openrouter.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.ts)). GHA jobs don't use `astro:env/server` — they read `process.env` directly — but the naming convention is worth preserving so operators only have to remember one set of secret names across runtime + CI.

The main design tension is which LLM provider the AI SDK talks to (see §Provider decision below).

## Detailed Findings

### 1. Existing CI/CD

- Single workflow: [`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml). Triggers: `push` to `main`, `pull_request` to `main`. Node 22, npm cache, `npm ci`. Runs lint / typecheck / test / DB-type-drift / build. No concurrency group. No matrix. No composite actions yet.
- Secrets already referenced in CI: `SUPABASE_URL`, `SUPABASE_KEY` — precedent for repo-level GHA secrets. Adding `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`) follows the same pattern.
- No `permissions:` block set. The new workflow must set `permissions: { pull-requests: write, contents: read, issues: write }` — required to post comments and set labels.

### 2. Repo topology (monorepo bootstrap needed)

- No `packages/` dir exists. No `"workspaces"` field in `package.json`. No `pnpm-workspace.yaml` / `turbo.json` / `nx.json`.
- Package manager is **npm** (`package-lock.json` present; no `packageManager` field). Node pinned to `22.14.0` via `.nvmrc`.
- Bootstrap for `packages/code-reviewer` requires exactly:
  1. Add `"workspaces": ["packages/*"]` to root `package.json`.
  2. `packages/code-reviewer/package.json` with `"type": "module"` (Node 22 is fine, and `@openrouter/ai-sdk-provider` is ESM-only).
  3. `packages/code-reviewer/tsconfig.json` — extend root `tsconfig.json` (which extends `astro/tsconfigs/strict`). Root has no `references` field today; the new package doesn't need one.
  4. No changes to root ESLint / Prettier / Husky — existing globs `*.{ts,tsx,astro}` and `*.{json,css,md}` (`package.json:79-86`) already cover `packages/**`.
- Root tsconfig has one path alias: `"@/*": ["./src/*"]`. The new package should NOT reuse it — keep the package self-contained so it can be invoked from GHA without depending on the Astro `src/` tree.

### 3. Repo LLM conventions to mirror

From [`src/lib/llm/openrouter.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.ts):

- **Stable error codes as `Error` messages** (not thrown types): `LLM_NOT_CONFIGURED`, `LLM_HTTP_ERROR`, `LLM_INVALID_OUTPUT`, `LLM_EMPTY_RESPONSE`. The new package should follow the same taxonomy so operators can grep logs consistently. Add one for the composite action itself, e.g. `AI_CR_DIFF_TOO_LARGE`.
- **45s AbortSignal timeout** on the fetch. Preserve this — the composite action's step should also have a job-level `timeout-minutes` guard so a stuck model call doesn't hold a runner.
- **No secret leakage**: the client truncates upstream error bodies to 240 chars and never logs the API key. The new package must do the same on structured-output failures.
- **Zod validation of LLM output** happens in the *caller* today ([`src/pages/api/cards/generate.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/pages/api/cards/generate.ts) — `GeneratedCardsSchema.safeParse`). With `generateObject`, that becomes redundant (the SDK enforces the schema at the model call). Just re-parse defensively if the review is going to be passed to `JSON.parse` on the GHA side to build the comment.

### 4. Vercel AI SDK — the right primitive is `generateObject`

Verified via context7 against `/vercel/ai`. Non-streaming, one-shot, schema-validated:

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const CriterionName = z.enum([
  'implementation_correctness',
  'idiomaticity',
  'complexity',
  'test_risk_coverage',
  'documentation',
  'security_and_safety',
]);

export const reviewSchema = z.object({
  criteria: z.array(z.object({
    name: CriterionName,
    score: z.number().int().min(1).max(10),
    rationale: z.string().min(1).max(500),
  })).length(6),
  overall: z.object({
    verdict: z.enum(['pass', 'fail']),
    summary: z.string().min(1).max(1000),
  }),
});
```

- Errors surface as **`NoObjectGeneratedError`** (guarded via `NoObjectGeneratedError.isInstance(err)`) for JSON/schema failures. HTTP/API failures propagate unchanged from the provider — the package must wrap them into the shared error taxonomy.
- **The SDK does not truncate diffs.** Token budgeting is the caller's job. The composite action step must clip the diff before it reaches the model — drop `package-lock.json`, generated files, and hard-cap total bytes. Exact context-window numbers for Claude Sonnet / gpt-4o-mini were **not confirmed via docs** — verify at provider pages before pinning a byte cap.
- **Derive pass/fail deterministically in TS**, don't trust the model's `verdict`. E.g. `fail` if any score ≤ 4 or average < 7. Keep the model's `verdict` as advisory and log if it disagrees with the deterministic rule.

### 5. Provider decision

Three viable paths (context7 confirms all three package identities):

| Path | Package | Trade-off |
|---|---|---|
| **Anthropic direct** | `@ai-sdk/anthropic` | Best for structured output — native `output_config.format: json_schema`. New secret `ANTHROPIC_API_KEY`. Different vendor from runtime LLM (OpenRouter). |
| **OpenRouter (first-class)** | `@openrouter/ai-sdk-provider` (v0.7.5, ESM-only, Node 22+) | Reuses existing `OPENROUTER_API_KEY` secret. `structuredOutputs.strict` defaults to `true`; can route to Anthropic or OpenAI models through OpenRouter. |
| **OpenAI-compat via OpenRouter's endpoint** | `@ai-sdk/openai` pointed at OpenRouter's base URL | Not confirmed as a supported/recommended path in docs. Skip. |

**Recommendation for the plan phase**: **OpenRouter first-class provider**. It reuses the secret operators already know from runtime and avoids introducing a second LLM vendor for one workflow. Downside: less mature than `@ai-sdk/anthropic` and the OpenRouter provider is still 0.x — expect breaking changes.

Install (versions to be pinned at plan time via `npm view <pkg> version`):

```bash
npm install --workspace=code-reviewer ai zod @openrouter/ai-sdk-provider
```

### 6. Composite action wiring

Per requirements: composite action separate from workflow so the workflow stays declarative. Typical shape:

```
.github/
  workflows/
    ai-code-review.yml       # trigger: pull_request + pull_request.labeled
  actions/
    ai-code-review/
      action.yml             # composite: setup-node → npm ci → node packages/code-reviewer/dist/cli.js
```

Trigger events required:
- `pull_request` (types: `opened`, `synchronize`, `reopened`) → always review.
- `pull_request` (type: `labeled`) with `if: github.event.label.name == 'ai-cr:review'` → on-demand retry.

Comment + label side-effects via `gh` CLI (pre-installed on GHA runners):
- `gh pr comment "$PR" --body-file review.md`
- `gh pr edit "$PR" --add-label ai-cr:passed --remove-label ai-cr:failed,ai-cr:review` (or the inverse)

Labels `ai-cr:passed` / `ai-cr:failed` must exist in the repo before the first run — one-time `gh label create` step, or documented in the plan's Progress checklist.

### 7. Diff-size hazard

The requirements list PR description as a "cost tradeoff" question. The bigger hidden hazard is **total input tokens** on wide PRs. Cheap mitigations before spending on a token counter:

- `git diff origin/${{ github.base_ref }}...HEAD -- . ':(exclude)package-lock.json' ':(exclude)**/*.min.*' ':(exclude)**/*.snap'`
- Hard byte cap (~200KB) — if exceeded, fail fast with a `AI_CR_DIFF_TOO_LARGE` label instead of running the model.

## Code References

- [`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml) — existing pipeline; the new workflow lives beside it.
- [`src/lib/llm/openrouter.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.ts) — error-code taxonomy + timeout + secret-safe error surface to mirror.
- [`src/lib/llm/schemas.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/schemas.ts) — Zod schema style used in this repo.
- [`src/pages/api/cards/generate.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/pages/api/cards/generate.ts) — caller-side defensive parse; mapping of LLM errors to `LLM_FAILURE`.
- [`astro.config.mjs`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/astro.config.mjs) — `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` naming convention.
- `package.json:79-86` — root lint-staged globs that already cover `packages/**`.
- `.nvmrc` — Node 22.14.0 (satisfies `@openrouter/ai-sdk-provider` ≥22 requirement).

## Architecture Insights

- **Keep the package standalone.** No import from `src/` — the composite action runs in a fresh clone; keeping the package free of Astro coupling means `npm ci` at the workspace root pulls only what the reviewer needs and the CI job can run before / independently of any Astro build.
- **Deterministic verdict in TypeScript, not model-derived.** The model is untrustworthy about pass/fail thresholds; it's reliable at rationale. Encode the threshold rule in code so the pass/fail signal is auditable and testable.
- **Error taxonomy shared across runtime + CI.** Reuse `LLM_HTTP_ERROR` / `LLM_INVALID_OUTPUT` / `LLM_EMPTY_RESPONSE`. Add `AI_CR_DIFF_TOO_LARGE` for the pre-flight gate.
- **Secrets rollout is a Progress checkbox** — per `context/foundation/lessons.md` ("Production env-var rollout needs a Progress checkbox, not prose"), the plan must include a `- [ ]` item for setting the reviewer's secret in the GitHub repo settings, not just prose. Same rule applies here: the composite action reads from `secrets.OPENROUTER_API_KEY` and will silently fail with `LLM_NOT_CONFIGURED` otherwise.

## Historical Context (from prior changes)

- [`context/changes/ci-cd-code-reviewer/requirements.md`](./requirements.md) — the source of the six criteria and the label-based retry contract.
- [`context/changes/ci-cd-code-reviewer/change.md`](./change.md) — asks for `packages/code-reviewer` using "the AI SDK" (Vercel AI SDK per §4).
- `context/foundation/roadmap.md` — code reviewer initiative listed on the roadmap.
- No prior CI/CD or GHA changes in `context/archive/` — this is greenfield for workflow automation in this repo.

## Related Research

None — first research artifact for this change.

## Open Questions

1. **PR description in the prompt** — requirements flag it as a "cost tradeoff." Recommendation: include it always; it's small compared to the diff and gives the model the author's stated intent (which is what criterion #1 "implementation correctness" scores against). Confirm at plan time.
2. **Model choice** — Sonnet-tier for cost, Opus-tier for quality? The plan should pick and record it as `OPENROUTER_MODEL` (or a dedicated `AI_CR_MODEL` var if it should diverge from runtime).
3. **Failure policy** — should `ai-cr:failed` block merge? Or advisory only? Requirements don't say. Recommendation: advisory (label + comment), no `required_status_check`. Confirm at plan time.
4. **Retry idempotency** — when `ai-cr:review` label is applied, should the previous comment be edited or a new one appended? Recommendation: append with a timestamp; keeps history visible on the PR.
5. **Diff byte cap** — pick a number (§7 suggests ~200KB) based on chosen model's context window.
