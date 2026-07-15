# CI/CD AI Code Reviewer — Plan Brief

> Full plan: `context/changes/ci-cd-code-reviewer/plan.md`
> Research: `context/changes/ci-cd-code-reviewer/research.md`

## What & Why

Ship an advisory AI code reviewer that runs on every PR to `main`, scores six named criteria on a 1–10 scale, posts a Markdown summary comment, and applies a `ai-cr:passed` or `ai-cr:failed` label. Adding an `ai-cr:review` label triggers a re-review. The reviewer lands as a new job inside the existing `.github/workflows/ci.yml` (not a separate workflow file), isolated via job-level `permissions:` and `concurrency:`. Motivation: bring consistent first-pass feedback to every PR so human reviewers can focus on higher-order concerns rather than mechanical checks — while staying advisory-only in phase 1 so a model outage or false positive never blocks merge.

## Starting Point

Greenfield on every axis: no composite actions, no `packages/` directory, no npm workspaces config, no Vercel AI SDK in the tree. What already exists that this builds on: the [`ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml) workflow (Node 22, npm ci) as a sibling, Zod 4.4.3 in root deps, and the [`src/lib/llm/openrouter.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.ts) error-taxonomy / secret-hygiene patterns to mirror.

## Desired End State

Every PR opened / synchronised against `main` gets a comment within ~1 minute containing 6 scored criteria + a deterministic pass/fail verdict. Either `ai-cr:passed` or `ai-cr:failed` is applied. Adding `ai-cr:review` produces a second timestamped comment (never edits prior ones). Model errors post an "unavailable" comment with no verdict label and the workflow itself stays green — the reviewer never blocks a merge in phase 1.

## Key Decisions Made

| Decision                       | Choice                                                                              | Why (1 sentence)                                                                                                                     | Source   |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Framing (composite action vs package) | Both — `packages/code-reviewer` + `.github/actions/ai-code-review/`         | Change.md asks for the TS package; requirements.md asks for the composite action — they compose cleanly.                              | Research |
| LLM SDK                        | Vercel AI SDK (`ai` + `generateObject`)                                             | Purpose-built for one-shot schema-validated output; typed errors via `NoObjectGeneratedError`.                                       | Research |
| Provider                       | `@openrouter/ai-sdk-provider` (first-class)                                          | Reuses existing `OPENROUTER_API_KEY` secret — one vendor across runtime + CI.                                                        | Plan     |
| Default model                  | `google/gemma-4-31b-it:free` via repo variable `AI_CR_MODEL`                        | Free tier keeps per-PR cost at zero for phase 1; deterministic verdict in TS mitigates schema-compliance variance at free tier.       | Plan     |
| Merge-blocking policy          | Advisory only (no required status check)                                            | Zero risk to velocity if model errs; humans stay in the loop; can flip to gating later without code changes.                          | Plan     |
| Diff scope + cap               | Exclude lockfiles/generated/minified; truncate at 3000 diff-lines on file boundaries | Bounded model cost + context; never mid-file cuts so partial diffs don't mislead the reviewer.                                        | Plan     |
| Retry comment behavior         | Append new comment with timestamp                                                    | Preserves iteration history; simpler than in-place edit; matches "audit the model's evolution over the PR" mental model.              | Plan     |
| Testing (phase 1)              | Vitest unit tests only — no live LLM                                                | Fast, deterministic, cheap; mirrors `src/lib/llm/openrouter.test.ts` pattern; live-call verification happens on first real PR.        | Plan     |
| Error handling on model failure | Post "unavailable" comment, no verdict label, workflow stays green                  | Advisory-only stance means model outages must not block merge; makes the failure visible without penalising the PR author.            | Plan     |
| Env-var naming                 | Secret `OPENROUTER_API_KEY` (shared) + variable `AI_CR_MODEL` (reviewer-specific)   | Model name isn't secret; separate variable lets reviewer and runtime use different models without workflow-file edits.                | Plan     |
| Workflow placement             | New `ai-code-review` job inside existing `ci.yml` (not a separate workflow file)    | Fewer files to reason about; job-level `permissions:` + `concurrency:` give the isolation a separate workflow would provide.          | Plan     |

## Scope

**In scope:**
- `packages/code-reviewer/` TS package (schema, prompt, diff scoping, LLM call, comment renderer, CLI) with full Vitest unit coverage
- Root workspace declaration (`"workspaces": ["packages/*"]` in `package.json`)
- `.github/actions/ai-code-review/action.yml` composite action
- New `ai-code-review` job added to `.github/workflows/ci.yml` (with `labeled` type + defensive `if:` gate on existing `ci` job)
- Operator runbook for the one-time repo setup (secret / variable / three labels)

**Out of scope:**
- A separate `.github/workflows/ai-code-review.yml` (merged into `ci.yml` instead)
- Merge-blocking via required status check (advisory only in phase 1)
- Editing prior comments on retry (append-only)
- Per-file map-reduce review for oversized PRs (truncate + note instead)
- Anthropic-direct provider fallback
- Live-LLM integration tests
- Extracting shared LLM code from `src/lib/llm/openrouter.ts` (runtime and reviewer stay independent)
- Refactoring existing `ci.yml` steps (lint / typecheck / test / build) into composite actions
- The two "parked" criteria from `requirements.md` (business alignment, architectural fit)

## Architecture / Approach

```
PR event ──► .github/workflows/ci.yml
                │  (workflow-level: no permissions block; default read)
                │
                ├──► job: ci  (existing — lint / typecheck / test / build)
                │      if: event.action != 'labeled'    ← defensive gate
                │
                └──► job: ai-code-review  (NEW)
                       if: event.action != 'labeled' || label.name == 'ai-cr:review'
                       permissions: pull-requests: write, issues: write, contents: read
                       concurrency: { group: ai-cr-<PR#>, cancel-in-progress: true }
                       timeout-minutes: 5
                          │
                          ▼
                 .github/actions/ai-code-review/action.yml
                       setup-node@v4 + npm ci + tsc build
                          │
                          ▼
                 packages/code-reviewer/dist/cli.js
                  ├── read env (PR meta, OPENROUTER_API_KEY, AI_CR_MODEL)
                  ├── git diff (exclude lockfiles/generated/minified)
                  ├── scopeDiff() ──► 3000-line cap, file-boundary aware
                  ├── reviewPR()  ──► @openrouter/ai-sdk-provider + generateObject
                  │                    ↳ Zod schema (6 criteria × 1–10 + summary)
                  │                    ↳ NoObjectGeneratedError → LLM_INVALID_OUTPUT
                  ├── computeVerdict() ──► deterministic pass/fail (mean ≥ 7, min > 4)
                  └── gh pr comment + gh pr edit --add-label
                        (on error → renderUnavailableComment + no label; exit 0)
```

Deterministic verdict rule (TS, not model): `fail` if any score ≤ 4 OR mean of six scores < 7; otherwise `pass`. Model's own `overall.verdict` is captured but only used for logging disagreement.

## Phases at a Glance

| Phase                              | What it delivers                                                                          | Key risk                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Workspace + reviewer package    | `packages/code-reviewer` with schema/prompt/diff/review/comment modules + Vitest coverage | Root workspace change causes `npm ci` regression in existing CI                        |
| 2. CLI entry + composite action    | `cli.ts` + `.github/actions/ai-code-review/action.yml` (dry-run mode for local testing)   | Shell-injection safety around `gh` + `git diff` calls; must use `execFileSync` with arg arrays |
| 3. Extend `ci.yml` + repo config   | New `ai-code-review` job in `ci.yml` + defensive `if:` gate on `ci` job + one-time repo setup (secret / variable / three labels) | Missing `if:` gate causes every label add to re-run full CI; free-tier model latency pushes runs past the 5-minute timeout |

**Prerequisites:** Repo admin access to set the secret, variable, and labels via `gh`. OpenRouter account with an API key that can access `google/gemma-4-31b-it:free`. Node 22.14.0 (already pinned via `.nvmrc`).

**Estimated effort:** ~2 sessions across 3 phases — phase 1 is the largest (schema + 5 test files), phases 2 + 3 are mostly YAML + one CLI file.

## Open Risks & Assumptions

- **Free-tier Gemma quality is unproven for code review**: the deterministic verdict rule + fail-safe unavailable-comment path mitigate the downside, but comment quality may be shallow — plan on revisiting model choice after ~10 real PRs.
- **`@openrouter/ai-sdk-provider` is at 0.7.5 (pre-1.0)**: minor version bumps may break the API; pin exact version at install time and re-verify on updates.
- **The workflow's 5-minute `timeout-minutes`** assumes p95 model latency ≤ 4 minutes at the free tier — if OpenRouter free-tier queuing pushes p95 higher, the workflow will start timing out mid-review. Watch after first live PRs.
- **`gh` CLI is pre-installed on `ubuntu-latest` runners** as of early 2026; if GitHub ever removes it, phase 3 breaks silently. Not currently pinned via `actions/setup-gh`.

## Success Criteria (Summary)

- A throwaway PR against `main` gets a review comment + one verdict label within ~1 minute of opening.
- Adding `ai-cr:review` to any PR appends a fresh timestamped comment (and removes the retry label at run end).
- A deliberately-broken run (invalid API key) posts an "unavailable" comment, applies no verdict label, and leaves the workflow itself green.
