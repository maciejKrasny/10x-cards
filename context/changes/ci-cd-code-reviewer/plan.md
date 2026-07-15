# CI/CD AI Code Reviewer Implementation Plan

## Overview

Introduce an advisory AI code reviewer that runs on every pull request targeting `main`. The reviewer scores six named criteria on a 1–10 scale (per [`requirements.md`](./requirements.md)), posts a Markdown summary as a PR comment, and applies one of two labels (`ai-cr:passed` / `ai-cr:failed`). A third label (`ai-cr:review`) triggers an on-demand re-review. The reviewer logic lives in a new `packages/code-reviewer` Node/TS package (using `@openrouter/ai-sdk-provider` + Vercel AI SDK `generateObject`), is wrapped in a reusable GitHub Actions composite action, and runs as a new `ai-code-review` job added to the existing [`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml) — with job-level `permissions:` and `concurrency:` so the reviewer's blast radius stays isolated from the existing `ci` job.

## Current State Analysis

This is a greenfield addition. Per [`research.md`](./research.md):

- **CI is Node 22 + `npm ci` on `pull_request` to `main`** ([`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml)). No composite actions today. No `permissions:` block. Node pinned to 22.14.0 via `.nvmrc` (satisfies `@openrouter/ai-sdk-provider` Node 22+ requirement).
- **No monorepo tooling**: no `packages/` directory, no `"workspaces"` field in `package.json`, no `pnpm-workspace.yaml` / `turbo.json` / `nx.json`. Package manager is npm (`package-lock.json` present).
- **No Vercel AI SDK footprint today**: `package.json` deps have no `ai`, `@ai-sdk/*`, `@anthropic-ai/*`, or `openai` packages. Zod 4.4.3 is already a dep.
- **Runtime LLM conventions to mirror** (from [`src/lib/llm/openrouter.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.ts)): stable string error codes (`LLM_NOT_CONFIGURED`, `LLM_HTTP_ERROR`, `LLM_INVALID_OUTPUT`, `LLM_EMPTY_RESPONSE`); 45s AbortSignal timeout; upstream error bodies truncated to 240 chars; no secrets logged.
- **Root lint-staged globs `*.{ts,tsx,astro}` already cover `packages/**`** — no per-package Husky config needed.

## Desired End State

When this plan is complete:

- Every PR opened / synchronised against `main` gets an AI-generated review comment within ~1 minute of push. The comment contains 6 scored criteria, a short rationale per criterion, and an overall pass/fail verdict computed deterministically in TypeScript.
- Either `ai-cr:passed` (green `#0e8a16`) or `ai-cr:failed` (red `#d93f0b`) is applied to the PR after the run.
- Adding the `ai-cr:review` label (grey/blue) triggers a fresh review that appends a new timestamped comment.
- Merge is NOT blocked by `ai-cr:failed` — the reviewer is advisory-only in phase 1.
- Model failures post a neutral "review unavailable" comment (no pass/fail label) and log the error code; the workflow itself succeeds so the PR is not blocked by reviewer outages.
- Verify by: opening a throwaway PR against `main` and confirming (a) a comment appears with all 6 criteria + verdict, (b) exactly one of the two verdict labels is applied, (c) applying `ai-cr:review` triggers a second comment with a distinct timestamp.

### Key Discoveries

- **`generateObject` errors surface as `NoObjectGeneratedError`** (guardable via `NoObjectGeneratedError.isInstance(err)`); underlying HTTP failures propagate from the provider without renaming — the package must wrap them into the shared error taxonomy. [research §4]
- **The AI SDK does not truncate diffs** — token budgeting is caller responsibility. [research §4]
- **`@openrouter/ai-sdk-provider` is ESM-only (v0.7.5)** — the new package needs `"type": "module"`. [research §5]
- **Root `tsconfig.json` extends `astro/tsconfigs/strict`** — the new package should have its own standalone `tsconfig.json` and NOT reuse the `@/*` → `./src/*` path alias, to keep the package Astro-free and invocable from a plain Node process. [research §2]
- **Free-tier models on OpenRouter (like `google/gemma-4-31b-it:free`) can be less strict about JSON-schema compliance** — the package must handle `NoObjectGeneratedError` gracefully rather than assume schema-valid output on every call. This is why the pass/fail verdict is computed deterministically in TS from the scores, not read from the model's `overall.verdict` field.

## What We're NOT Doing

- **Not blocking merges.** No `required_status_check` on branch protection. The reviewer is advisory in phase 1; a merge-gating flip is out of scope.
- **Not editing prior comments on retry.** Each run appends a new timestamped comment. No `<details>` collapsing of prior comments.
- **Not implementing per-file map-reduce review.** One model call per PR, diff truncated at 3000 lines (file-boundary aware) if oversized.
- **Not adding a second LLM vendor.** Only OpenRouter; no `@ai-sdk/anthropic` fallback path.
- **Not shipping live-LLM integration tests.** Vitest unit coverage only in phase 1. Live smoke happens on the first real PR (phase 3 manual verification).
- **Not extracting shared LLM code from `src/lib/llm/openrouter.ts`.** The runtime client and the reviewer stay independent; the package mirrors the *patterns* (error codes, secret hygiene, timeout) without importing runtime code.
- **Not covering the two parked criteria** (business alignment, architectural fit) from `requirements.md` — those need broader context than a diff-only prompt provides.
- **Not creating a separate `.github/workflows/ai-code-review.yml`.** The reviewer is a new job inside the existing `ci.yml`, isolated via job-level `permissions:` and `concurrency:`.
- **Not refactoring existing `ci.yml` steps** (lint / typecheck / test / build) into composite actions. Only the new reviewer job uses a composite action.

## Implementation Approach

Three sequential phases, each independently verifiable:

1. **All TS work first.** Bootstrap workspaces + reviewer package + unit tests. Nothing touches `.github/` in phase 1, so it can land without any workflow risk.
2. **Wire the CLI + composite action.** The CLI reads `process.env`, calls the reviewer, and shells out to `gh` for side-effects. `AI_CR_DRY_RUN=1` prints intended actions instead of executing them — this is the local verification path for phase 2.
3. **Add the reviewer job to `ci.yml` + repo config.** Extend the existing workflow with a new `ai-code-review` job (job-level `permissions:` + `concurrency:`) plus the `labeled` trigger type; gate the existing `ci` job so label changes don't re-run it. Complete the one-time repo setup (secret, variable, three labels). First live PR is the manual verification gate.

Deterministic verdict rule (encoded in TS, not left to the model): **`fail` if any criterion score ≤ 4 OR arithmetic mean of all six scores < 7; otherwise `pass`.** The model's own `overall.verdict` field is captured in the output but only used for logging any disagreement with the deterministic rule.

## Critical Implementation Details

- **Diff truncation is file-boundary-aware.** Iterate files in `git diff` output in the order git produces them; include each file's diff hunks in full until adding the next file would push total lines past 3000; skip the remainder. The comment's header line reports `Reviewed N of M files (truncated at 3000-line budget)` and lists skipped files. Never truncate mid-file — a partial diff of a file misleads the reviewer more than skipping the file entirely.
- **Env-var naming split.** API key stays as `OPENROUTER_API_KEY` (repo **secret**, shared with runtime). Model comes from `AI_CR_MODEL` (repo **variable**, `google/gemma-4-31b-it:free` as default). Do NOT reuse `OPENROUTER_MODEL` — that variable is scoped to the Astro runtime (`openai/gpt-4o-mini`) and the two consumers want different models.
- **ESM-only package.** `packages/code-reviewer/package.json` must declare `"type": "module"`, and `tsconfig.json` must set `"module": "NodeNext"` + `"moduleResolution": "NodeNext"`. The CLI shebang is `#!/usr/bin/env node` and the file uses `.js` imports for cross-compiled TS.

## Phase 1: Workspace + reviewer package (TS only)

### Overview

Convert the repo root into an npm workspace, scaffold `packages/code-reviewer/`, implement the reviewer's pure TypeScript surface (schema, prompt, diff scoper, LLM call, comment renderer), and cover it with Vitest unit tests. No CI/CD wiring in this phase.

### Changes Required

#### 1. Root workspace declaration

**File**: `package.json`

**Intent**: Enable npm workspaces so a sibling `packages/code-reviewer` can install and share the root `node_modules`. Add the AI SDK + OpenRouter provider as workspace-scoped deps in the next step, not root deps.

**Contract**: Add `"workspaces": ["packages/*"]` at the top level of `package.json`. Do not modify existing `scripts`, `dependencies`, or `devDependencies` in this file — the reviewer package brings its own.

#### 2. Reviewer package skeleton

**Files**:

- `packages/code-reviewer/package.json`
- `packages/code-reviewer/tsconfig.json`
- `packages/code-reviewer/README.md`

**Intent**: Create the workspace package with ESM module type, its own strict TS config, and a short README explaining the package boundary (runs in Node in GHA; not imported by the Astro app).

**Contract**:

- `package.json` declares `"name": "@10x-cards/code-reviewer"`, `"version": "0.1.0"`, `"type": "module"`, `"private": true`, `"main": "./dist/index.js"`, `"bin": { "ai-code-review": "./dist/cli.js" }`, `"scripts": { "build": "tsc -p .", "test": "vitest run", "lint": "eslint ." }`. Dependencies: `ai`, `zod`, `@openrouter/ai-sdk-provider`. DevDependencies: `vitest`, `typescript`, `@types/node`. Pin exact versions at install time.
- `tsconfig.json` extends `../../tsconfig.json`, sets `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"outDir": "./dist"`, `"rootDir": "./src"`, `"strict": true`, `"declaration": false`. Does NOT define `paths` — the package is self-contained.
- `README.md`: 15–20 lines. Purpose, "how to run locally" (`npm run --workspace @10x-cards/code-reviewer build && node packages/code-reviewer/dist/cli.js`), env vars consumed, exit codes.

#### 3. Review schema

**File**: `packages/code-reviewer/src/schema.ts`

**Intent**: Define the Zod schema that `generateObject` enforces at the model boundary + the derived TypeScript type used across the package. Six criteria enumerated by the exact names from `requirements.md`, each with int score 1–10 and a bounded rationale string.

**Contract**: Exports `CriterionName` (Zod enum: `implementation_correctness`, `idiomaticity`, `complexity`, `test_risk_coverage`, `documentation`, `security_and_safety`), `reviewSchema` (object with `criteria: length(6)` and `overall: { verdict: "pass"|"fail", summary }`), `type Review = z.infer<typeof reviewSchema>`, and `computeVerdict(criteria): "pass" | "fail"` implementing the deterministic rule (`fail` if any score ≤ 4 OR mean < 7).

#### 4. Diff scoper

**File**: `packages/code-reviewer/src/diff.ts`

**Intent**: Take the raw `git diff` output for the PR and return a scoped version that (a) excludes generated/lockfile/binary paths and (b) truncates at 3000 lines on file boundaries, reporting what was reviewed vs skipped.

**Contract**: Exports `scopeDiff(rawDiff: string, maxLines = 3000): { diff: string; reviewedFiles: string[]; skippedFiles: string[]; truncated: boolean }`. The exclusion list is a constant in this file: `package-lock.json`, `**/*.min.*`, `**/*.snap`, `src/db/database.types.ts`, `dist/**`, `.astro/**`. Note that the `git diff` command in the composite action already excludes these via `':(exclude)'` patterns — this function is defensive belt-and-braces plus provides the truncation logic. Parses `diff --git a/... b/...` file boundaries with a simple regex; keeps every hunk of a file together.

#### 5. Prompt builder

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Compose the system + user prompts for `generateObject`. System prompt states the criteria and 1–10 scoring rubric verbatim from `requirements.md`. User prompt includes PR title, PR description, and the scoped diff.

**Contract**: Exports `buildPrompt({ title, description, diff, truncationNote }: PromptInput): { system: string; prompt: string }`. The rubric text in the system prompt is copied verbatim from `requirements.md` sections 12–38 — future edits to the rubric happen in this file, not by editing `requirements.md`. `truncationNote` is included in the user prompt when non-empty so the model knows it saw a subset.

#### 6. LLM caller

**File**: `packages/code-reviewer/src/review.ts`

**Intent**: Configure the OpenRouter provider, call `generateObject` with the schema, wrap all errors into the shared taxonomy, and compute the deterministic verdict. 45-second `AbortSignal.timeout()` mirrors the runtime pattern.

**Contract**: Exports `async function reviewPR(input: PromptInput, env: { apiKey: string; model: string }): Promise<Review & { deterministicVerdict: "pass" | "fail" }>`. Throws `Error` with stable code messages: `LLM_NOT_CONFIGURED` (missing `env.apiKey`), `LLM_HTTP_ERROR` (provider HTTP failure — truncate upstream body to 240 chars in the error message, no secrets), `LLM_INVALID_OUTPUT` (`NoObjectGeneratedError`), `LLM_EMPTY_RESPONSE` (SDK returned no object). Never logs the API key. Never includes the model output verbatim in thrown error messages beyond the 240-char truncation limit.

#### 7. Comment renderer

**File**: `packages/code-reviewer/src/comment.ts`

**Intent**: Turn a `Review` + run metadata (timestamp, commit SHA, model name, truncation info) into the Markdown body posted as a PR comment. One canonical layout so users can quickly scan verdicts across runs.

**Contract**: Exports `renderComment(review: Review, meta: CommentMeta): string`. Format: an `<!-- ai-code-review:v1 -->` HTML hidden marker at the top (future retry logic can grep for it), then an H2 title with verdict emoji + label, a table of criteria × score × short rationale, the overall summary paragraph, and a footer line with timestamp / commit / model / truncation note. Also exports `renderUnavailableComment(errorCode: string, meta: CommentMeta): string` for the fail-safe path.

#### 8. Vitest unit tests

**Files**:

- `packages/code-reviewer/src/schema.test.ts`
- `packages/code-reviewer/src/diff.test.ts`
- `packages/code-reviewer/src/prompt.test.ts`
- `packages/code-reviewer/src/review.test.ts`
- `packages/code-reviewer/src/comment.test.ts`

**Intent**: Cover the fragile parts of the pipeline with deterministic tests. Mirror the mock pattern from [`src/lib/llm/openrouter.test.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.test.ts) — mock the AI SDK at the module boundary; no real HTTP.

**Contract**:

- `schema.test.ts`: rejects wrong criterion count, non-integer scores, out-of-range scores, missing overall verdict; `computeVerdict` returns `fail` when any score ≤ 4, `fail` when mean < 7, `pass` otherwise.
- `diff.test.ts`: excluded paths are stripped; truncation kicks in above the cap; truncation is file-boundary-aware (no half files); `reviewedFiles` and `skippedFiles` are populated correctly; empty diff returns empty result without error.
- `prompt.test.ts`: system prompt contains the 6 criterion names verbatim; user prompt contains title + description + diff; truncation note is appended when supplied.
- `review.test.ts`: each error path throws with the correct stable code; API key never appears in thrown message; upstream error body truncated to 240 chars; deterministic verdict overrides model verdict when they disagree.
- `comment.test.ts`: rendered Markdown contains the `<!-- ai-code-review:v1 -->` marker; verdict label + emoji reflect deterministic verdict; unavailable-comment path renders the error code but not any secrets.

### Success Criteria

#### Automated Verification

- `packages/code-reviewer/` exists with `package.json`, `tsconfig.json`, `src/`, and no `dist/` under source control.
- Root `package.json` contains `"workspaces": ["packages/*"]`.
- `npm ci` at the repo root installs the package's deps into a hoisted `node_modules` without errors.
- `npm run --workspace @10x-cards/code-reviewer build` produces `dist/{schema,diff,prompt,review,comment}.js`.
- `npm run --workspace @10x-cards/code-reviewer test` passes with all Vitest suites green.
- `npm run lint` at repo root passes (root ESLint flat config picks up the new files).
- `npm run typecheck` passes.

#### Manual Verification

- Read the schema and confirm the six criterion enum names match `requirements.md` verbatim.
- Read the rendered comment output from a Vitest snapshot: verify the verdict rule is correctly reported and the truncation footer is clear.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual review was successful before proceeding to Phase 2.

---

## Phase 2: CLI entry + composite action

### Overview

Add the `cli.ts` entry point that glues the reviewer to GitHub via `process.env` inputs and `gh` CLI side-effects, and create the composite action YAML that runs the CLI. `AI_CR_DRY_RUN=1` prints planned actions to stdout instead of calling `gh` — this is the local verification path.

### Changes Required

#### 1. CLI entry point

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Node entry point invoked by the composite action. Reads PR context + secrets from `process.env`, runs `git diff` between base and head refs, calls `reviewPR`, and posts the comment + labels via `gh`. In dry-run mode, prints the intended `gh` invocations to stdout without executing them. Exits 0 on success (including on LLM failure with a fail-safe "unavailable" comment), non-zero only on setup errors (missing required env, `gh` not available).

**Contract**: `#!/usr/bin/env node` shebang. Required env: `GH_TOKEN` (or `GITHUB_TOKEN`), `GITHUB_REPOSITORY`, `PR_NUMBER`, `BASE_REF`, `HEAD_REF`, `OPENROUTER_API_KEY`, `AI_CR_MODEL`. Optional env: `AI_CR_DRY_RUN`, `AI_CR_MAX_DIFF_LINES` (default 3000). Uses `child_process.execFileSync` (never `exec` with a shell) for both `git diff` and `gh` calls to prevent injection. `gh` invocations: `gh pr comment "$PR_NUMBER" --body-file <tempfile>` and `gh pr edit "$PR_NUMBER" --add-label "$verdictLabel" --remove-label "$oppositeLabel" --remove-label "ai-cr:review"`. On any `Error` thrown by `reviewPR`, catch, render an unavailable comment with the error code, post it, and do NOT apply a verdict label.

#### 2. Composite action YAML

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Wrap the CLI in a reusable composite action so the workflow stays declarative. Sets up Node, runs `npm ci` at the repo root (which installs the workspace package), builds the package, invokes the CLI with mapped inputs.

**Contract**: `name: 'AI Code Review'`, `description: 'Run the AI code reviewer on the current PR'`, `runs.using: 'composite'`. Inputs: `openrouter-api-key` (required), `model` (required), `github-token` (required), `pr-number` (required), `base-ref` (required), `head-ref` (required), `max-diff-lines` (optional, default `3000`). Steps: (1) `actions/setup-node@v4` with `node-version-file: .nvmrc` + `cache: npm`, (2) `run: npm ci` (composite `shell: bash`), (3) `run: npm run --workspace @10x-cards/code-reviewer build`, (4) `run: node packages/code-reviewer/dist/cli.js` with all inputs mapped to env vars. `working-directory: ${{ github.workspace }}` on all shell steps.

#### 3. CLI unit tests

**File**: `packages/code-reviewer/src/cli.test.ts`

**Intent**: Verify env-var validation, `AI_CR_DRY_RUN` behavior, and command-argument construction without spawning real subprocesses. Mock `child_process.execFileSync` and the `reviewPR` module.

**Contract**: Tests: (1) missing required env exits with code 2 and a clear error mentioning the missing var name; (2) `AI_CR_DRY_RUN=1` prints intended `gh` calls to stdout, does not spawn `gh`; (3) verdict `pass` produces `--add-label ai-cr:passed --remove-label ai-cr:failed --remove-label ai-cr:review`; (4) thrown `LLM_HTTP_ERROR` results in an unavailable comment posted, no verdict label applied, exit 0; (5) `git diff` command line contains all excluded-path patterns; (6) argument construction never uses shell interpolation (arguments passed as array to `execFileSync`).

### Success Criteria

#### Automated Verification

- `packages/code-reviewer/dist/cli.js` builds and has an executable shebang.
- `npm run --workspace @10x-cards/code-reviewer test` passes (now including `cli.test.ts`).
- `AI_CR_DRY_RUN=1 GH_TOKEN=fake GITHUB_REPOSITORY=fake/fake PR_NUMBER=1 BASE_REF=main HEAD_REF=HEAD OPENROUTER_API_KEY=fake AI_CR_MODEL=fake node packages/code-reviewer/dist/cli.js` prints the intended `gh` invocations without contacting the network.
- `actionlint` (or GitHub's built-in YAML validation) accepts `.github/actions/ai-code-review/action.yml`.
- `npm run typecheck` passes.

#### Manual Verification

- Read the dry-run stdout: confirm the `gh pr comment` and `gh pr edit` commands look correct and no secrets are printed.
- On a local branch with an intentional diff, run the CLI end-to-end against a personal test PR (using a personal access token) and confirm the comment appears — this is optional and outside CI.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the dry-run output was reviewed before proceeding to Phase 3.

---

## Phase 3: Extend ci.yml + repo configuration

### Overview

Modify the existing [`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml) to add the `labeled` PR event type and a new `ai-code-review` job that invokes the composite action. The reviewer job uses **job-level** `permissions:` and `concurrency:` so its write scopes and cancellation behavior stay isolated from the existing `ci` job. A defensive `if:` gate on the existing `ci` job prevents label changes from re-triggering the full pipeline. Complete the one-time repo setup (secret, variable, three labels). First live PR is the manual verification gate.

### Changes Required

#### 1. Extend `ci.yml` triggers + gate existing `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Add `labeled` to `pull_request.types` so the retry label can fire the workflow, and add an `if:` gate on the existing `ci` job so that label changes (which include the new retry label but also any other label activity) don't re-run lint / typecheck / tests / DB reset / build.

**Contract**: Under `on.pull_request`, add `types: [opened, synchronize, reopened, labeled]` (default types are opened/synchronize/reopened — this adds `labeled` explicitly). Add `if: github.event_name != 'pull_request' || github.event.action != 'labeled'` at the top of the existing `ci` job (before `runs-on`). No other changes to existing `ci` steps.

#### 2. Add the `ai-code-review` job to `ci.yml`

**File**: `.github/workflows/ci.yml`

**Intent**: New job in the same workflow that runs the composite action. Job-level `permissions:` grants only what the reviewer needs (`pull-requests: write` for comments, `issues: write` for labels on PRs, `contents: read` for checkout); the existing `ci` job's permissions are unaffected. Job-level `concurrency:` cancels only in-flight reviewer runs on new pushes — the `ci` job is unaffected. Job runs independently of `ci` (no `needs:`), so reviewer latency doesn't gate CI reporting.

**Contract**: New job keyed `ai-code-review` under `jobs:`. Attributes: `if: github.event_name == 'pull_request' && (github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review')`; `runs-on: ubuntu-latest`; `timeout-minutes: 5`; `permissions: { pull-requests: write, issues: write, contents: read }`; `concurrency: { group: 'ai-cr-${{ github.event.pull_request.number }}', cancel-in-progress: true }`. Steps: (1) `actions/checkout@v4` with `fetch-depth: 0` (required for `git diff` against base ref), (2) `uses: ./.github/actions/ai-code-review` with inputs `openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}`, `model: ${{ vars.AI_CR_MODEL }}`, `github-token: ${{ secrets.GITHUB_TOKEN }}`, `pr-number: ${{ github.event.pull_request.number }}`, `base-ref: ${{ github.event.pull_request.base.ref }}`, `head-ref: ${{ github.event.pull_request.head.sha }}`. Do NOT add workflow-level `permissions:` or `concurrency:` blocks — keep them job-scoped.

#### 3. Documentation / operator runbook

**File**: `packages/code-reviewer/README.md` (extend the file created in Phase 1)

**Intent**: Give the operator a one-screen checklist to set the reviewer up in a fresh clone or repo copy. Covers the three one-time GitHub-side actions.

**Contract**: Add a `## Repo setup (one-time)` section listing the exact `gh` CLI commands: `gh secret set OPENROUTER_API_KEY`, `gh variable set AI_CR_MODEL --body 'google/gemma-4-31b-it:free'`, `gh label create ai-cr:passed --color 0e8a16`, `gh label create ai-cr:failed --color d93f0b`, `gh label create ai-cr:review --color c5def5 --description 'Add to trigger a re-review'`. Note that `OPENROUTER_API_KEY` is a **repo secret** (encrypted, hidden from logs) while `AI_CR_MODEL` is a **repo variable** (plain-text, visible to workflow logs — model names are not secret).

### Success Criteria

#### Automated Verification

- `.github/workflows/ci.yml` is valid YAML and `actionlint` (or GitHub's parser) accepts it after the edit.
- `ci.yml` references `./.github/actions/ai-code-review` (relative path resolves).
- `on.pull_request.types` includes `labeled`.
- The existing `ci` job has `if: github.event_name != 'pull_request' || github.event.action != 'labeled'` set.
- The new `ai-code-review` job has `permissions:` and `concurrency:` blocks defined at the **job** level (not the workflow level).
- `npm run lint` at repo root passes.

#### Manual Verification

- `OPENROUTER_API_KEY` is set at repo secret scope (verified via `gh secret list`).
- `AI_CR_MODEL` is set at repo variable scope with value `google/gemma-4-31b-it:free` (verified via `gh variable list`).
- All three labels exist in the repo with correct colors (verified via `gh label list`).
- Open a throwaway PR against `main`: within ~1 minute, a comment appears containing all 6 criterion scores and a verdict.
- Exactly one of `ai-cr:passed` / `ai-cr:failed` is applied to the PR.
- Add the `ai-cr:review` label manually: a second comment appears with a distinct timestamp, and the retry label is removed at the end of the run.
- Add an arbitrary non-`ai-cr:review` label to a PR: the `ci` job does NOT re-run (verified in Actions tab — no new `ci` run appears) and neither does `ai-code-review`.
- Push an empty commit while a review is running: the in-flight `ai-code-review` job is cancelled by the concurrency group, but the `ci` job for the previous push continues to completion (job-level concurrency proven not to affect `ci`).
- Inject a deliberate failure (temporarily unset the secret or use an invalid key) on a test PR: an "unavailable" comment is posted, no verdict label is applied, and both the `ai-code-review` job and the overall workflow run stay green.

**Implementation Note**: All Phase 3 manual verification items must be ticked before the change can be archived. First live PR is the gate.

---

## Testing Strategy

### Unit Tests

- **`schema.test.ts`** — Zod boundary rejections, `computeVerdict` truth table, deterministic-vs-model verdict disagreement logging.
- **`diff.test.ts`** — file-boundary truncation, exclusion patterns, oversized single-file handling, empty diff.
- **`prompt.test.ts`** — verbatim criterion names in system prompt, PR context inclusion, truncation-note conditional.
- **`review.test.ts`** — each error path throws the correct stable code with no secret leakage; upstream body truncated to 240 chars.
- **`comment.test.ts`** — Markdown structure, verdict emoji/label mapping, unavailable-comment fail-safe.
- **`cli.test.ts`** — env-var validation, `AI_CR_DRY_RUN` short-circuit, `gh` argument construction, exit codes.

### Integration Tests

None in phase 1. The composite action + workflow YAML are verified by first live PR (Phase 3 manual verification).

### Manual Testing Steps

Sequential, all in Phase 3:

1. Open a small (< 100 line) PR against `main`. Confirm comment + verdict label appear within 60s.
2. Open a large (> 3000 line diff) PR. Confirm the comment header says `Reviewed N of M files (truncated at 3000-line budget)` and lists skipped files.
3. On any PR with a posted review, add the `ai-cr:review` label. Confirm a second comment appears with a later timestamp and the retry label is removed.
4. Push a new commit while a review is running (open a PR, then push within ~30s). Confirm only the newer run's comment appears.
5. Temporarily set `AI_CR_MODEL` to an invalid model on a test PR. Confirm the "unavailable" comment is posted, no verdict label is applied, workflow run is green.

## Performance Considerations

- **Per-PR cost is bounded** by the 3000-line diff cap and the free-tier Gemma model. At the free tier, per-PR monetary cost is $0; the ceiling is OpenRouter's per-key rate limit (verify at deploy time).
- **Latency budget: 5 minutes** (workflow `timeout-minutes: 5`). Free-tier model latency can be high and variable — if p95 approaches the limit, revisit the model choice or bump the budget.
- **Concurrency cancellation** on new pushes to the same PR prevents wasted spend on stale reviews.

## Migration Notes

None. Greenfield workflow addition; nothing removed or renamed. No data migration.

The one-time repo setup (secret, variable, three labels) is captured as `## Progress` checkboxes below — per [`context/foundation/lessons.md`](../../foundation/lessons.md) rule "Production env-var rollout needs a Progress checkbox, not prose."

## References

- Requirements: [`context/changes/ci-cd-code-reviewer/requirements.md`](./requirements.md)
- Research: [`context/changes/ci-cd-code-reviewer/research.md`](./research.md)
- Change identity: [`context/changes/ci-cd-code-reviewer/change.md`](./change.md)
- Runtime LLM patterns to mirror: [`src/lib/llm/openrouter.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.ts) and [`src/lib/llm/openrouter.test.ts`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/src/lib/llm/openrouter.test.ts)
- Existing CI as reference: [`.github/workflows/ci.yml`](https://github.com/maciejKrasny/10x-cards/blob/1e98d66812bbf149e52015efa35d55cacb0e6e1b/.github/workflows/ci.yml)
- Lessons priors: [`context/foundation/lessons.md`](../../foundation/lessons.md)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Workspace + reviewer package

#### Automated

- [x] 1.1 packages/code-reviewer/ exists with package.json, tsconfig.json, src/, and no dist/ under source control
- [x] 1.2 root package.json contains "workspaces": ["packages/*"]
- [x] 1.3 npm ci at repo root installs the package's deps into a hoisted node_modules without errors
- [x] 1.4 npm run --workspace @10x-cards/code-reviewer build produces dist/{schema,diff,prompt,review,comment}.js
- [x] 1.5 npm run --workspace @10x-cards/code-reviewer test passes with all Vitest suites green
- [x] 1.6 npm run lint at repo root passes (root ESLint flat config picks up the new files)
- [x] 1.7 npm run typecheck passes

#### Manual

- [ ] 1.8 read the schema and confirm the six criterion enum names match requirements.md verbatim
- [ ] 1.9 read the rendered comment output from a Vitest snapshot: verify the verdict rule is correctly reported and the truncation footer is clear

### Phase 2: CLI entry + composite action

#### Automated

- [ ] 2.1 packages/code-reviewer/dist/cli.js builds and has an executable shebang
- [ ] 2.2 npm run --workspace @10x-cards/code-reviewer test passes (now including cli.test.ts)
- [ ] 2.3 AI_CR_DRY_RUN=1 invocation prints the intended gh commands without contacting the network
- [ ] 2.4 actionlint (or GitHub's built-in YAML validation) accepts .github/actions/ai-code-review/action.yml
- [ ] 2.5 npm run typecheck passes

#### Manual

- [ ] 2.6 read the dry-run stdout: confirm the gh pr comment and gh pr edit commands look correct and no secrets are printed
- [ ] 2.7 (optional) end-to-end run against a personal test PR confirms the comment appears

### Phase 3: Extend ci.yml + repo configuration

#### Automated

- [ ] 3.1 .github/workflows/ci.yml is valid YAML and actionlint (or GitHub's parser) accepts it after the edit
- [ ] 3.2 ci.yml references ./.github/actions/ai-code-review (relative path resolves)
- [ ] 3.3 on.pull_request.types includes labeled
- [ ] 3.4 existing ci job has if: github.event_name != 'pull_request' || github.event.action != 'labeled' set
- [ ] 3.5 new ai-code-review job has permissions: and concurrency: blocks defined at the job level (not workflow level)
- [ ] 3.6 npm run lint at repo root passes

#### Manual

- [ ] 3.7 OPENROUTER_API_KEY is set at repo secret scope (verified via gh secret list)
- [ ] 3.8 AI_CR_MODEL is set at repo variable scope with value google/gemma-4-31b-it:free (verified via gh variable list)
- [ ] 3.9 ai-cr:passed label exists with color 0e8a16 (verified via gh label list)
- [ ] 3.10 ai-cr:failed label exists with color d93f0b (verified via gh label list)
- [ ] 3.11 ai-cr:review label exists (verified via gh label list)
- [ ] 3.12 throwaway PR against main produces a comment with all 6 criterion scores and a verdict within ~1 minute
- [ ] 3.13 exactly one of ai-cr:passed / ai-cr:failed is applied to the PR
- [ ] 3.14 adding ai-cr:review triggers a second comment with a distinct timestamp; retry label is removed at end of run
- [ ] 3.15 adding an arbitrary non-ai-cr:review label to a PR does NOT re-run the ci job (verified in Actions tab)
- [ ] 3.16 pushing an empty commit while a review is running cancels the in-flight ai-code-review job; the ci job for the previous push continues to completion
- [ ] 3.17 deliberate failure (invalid key on a test PR) posts an "unavailable" comment, applies no verdict label, both the ai-code-review job and the overall workflow run stay green
