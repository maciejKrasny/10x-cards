# CI/CD Code-Reviewer Adjustments Implementation Plan

## Overview

Extend `packages/code-reviewer` with (a) a modest structural refactor of `cli.ts`, (b) a stderr-only event logger, (c) a `findings[]` schema field surfaced as a `### Findings` section in the PR comment, and (d) a fix so stale `ai-cr:passed` / `ai-cr:failed` labels are cleared on the fail-safe (error) path — not only on the happy path. Requirements are captured in `context/changes/ci-cd-reviewer-adjustments/requirements.md`.

## Current State Analysis

- `cli.ts` (216 lines, `packages/code-reviewer/src/cli.ts:1-216`) mixes env parsing (`parseEnv`), git/gh side-effects (`postComment`, `applyLabels`, `removeRetryLabel`, `fetchPRField`), and orchestration (`runCli`) in one file. It is tested end-to-end in `cli.test.ts`.
- `diff.ts` (`packages/code-reviewer/src/diff.ts:35`) splits by file (`splitDiffByFile`) and scopes to a line budget (`scopeDiff`). It does NOT expose per-file hunk line-ranges, which the new line-in-hunk validation for findings needs.
- `review.ts` (`packages/code-reviewer/src/review.ts:29`) calls the LLM via `generateText` + `Output.object` with the permissive `modelOutputSchema` and strict `reviewSchema` post-validation — this split exists because Azure-hosted OpenRouter models reject strict JSON-Schema features (see `schema.ts:34-54`). The findings addition must follow the same pattern.
- `schema.ts` (`packages/code-reviewer/src/schema.ts:1-69`) defines the 6 criteria, `reviewSchema`, and the deterministic `computeVerdict` (min-score ≤ 4 → fail; mean < 7 → fail; else pass).
- `comment.ts` (`packages/code-reviewer/src/comment.ts:1-76`) renders the PR comment with `<!-- ai-code-review:v1 -->` marker, criteria table, summary, footer, and produces the label constants.
- `cli.ts:150-170` (`applyLabels`) already removes the opposite verdict label on the happy path — the requirement to "clear the previous label when the verdict flips" is already satisfied for successful reviews.
- `cli.ts:172-179` (`removeRetryLabel`) is the fail-safe-path label logic — it only strips `ai-cr:review`. Stale `ai-cr:passed` / `ai-cr:failed` from a previous commit are left in place, so a failed review after a passing review leaves the misleading green label. This is the real label-hygiene gap.
- `.github/actions/ai-code-review/action.yml` plumbs env vars per composite-action input (`openrouter-api-key`, `model`, `pr-number`, `base-ref`, `head-ref`, `max-diff-lines`). New env vars belong here as optional inputs for discoverability.
- Comments are appended (`cli.ts:147` uses `gh pr comment`, not `--edit-last`), so the `<!-- ai-code-review:v1 -->` marker is currently just a version label with no de-duplication behavior. Bumping to v2 has no functional effect and is not required.
- Package uses vitest with per-module `*.test.ts` files — each new module gets its own test file matching this convention.

## Desired End State

`packages/code-reviewer` is organized into small single-responsibility modules; every important action the CLI takes emits a structured log line to stderr (grouped for GitHub Actions readability); every PR comment includes a `### Findings` section beneath the criteria table when the model returned valid per-line findings, and omits it when it did not; and when the reviewer errors and posts the "unavailable" comment, any stale `ai-cr:passed` / `ai-cr:failed` from a prior run on the PR is also cleared.

Verified by:
- `npm run --workspace @10x-cards/code-reviewer test` passes (all existing tests plus new module tests).
- `npm run --workspace @10x-cards/code-reviewer lint` passes.
- `npm run --workspace @10x-cards/code-reviewer build` passes.
- Manual: opening a PR against `main` with a real diff produces a comment whose `### Findings` section shows at least one file:line entry when the model spots issues, and is omitted for clean PRs.
- Manual: forcing an LLM failure (bad API key) on a PR that previously had `ai-cr:passed` removes both `ai-cr:review` and `ai-cr:passed`.

### Key Discoveries:

- Permissive-vs-strict schema pattern (`schema.ts:34-54`) — findings addition must use it too, or Azure-hosted models will reject the request.
- `splitDiffByFile` (`diff.ts:35`) returns `FileChunk { path, content, lineCount }` — line-range extraction requires a new helper that parses `@@ -a,b +c,d @@` hunk headers on the `+` side.
- `applyLabels` on the happy path (`cli.ts:150-170`) already covers verdict flips — no change needed there.
- Composite-action inputs (`action.yml:14-27`) all map to env vars 1:1 — the pattern for new inputs is trivial.
- Package README (`packages/code-reviewer/README.md:19-30`) documents env vars in a table — must be updated with the two new optional vars.
- `lessons.md` "Production env-var rollout needs a Progress checkbox" applies to `AI_CR_LOG_LEVEL` and `AI_CR_MAX_FINDINGS` IF non-default values are desired in CI (`gh variable set …`). Defaults are safe, so a `gh variable set` step is optional but included in the Progress checklist for completeness.

## What We're NOT Doing

- No change to the deterministic verdict rules in `computeVerdict` — severity on findings is informational only.
- No change to the six review criteria or their prompt rubric.
- No change to the happy-path label logic (already removes opposite verdict label + retry label).
- No bump of the `<!-- ai-code-review:v1 -->` marker (schema change is additive; comments are appended, so marker version is inert).
- No change to how the reviewer is triggered (workflow file `ci.yml:46-68` is unchanged).
- No new external runtime dependencies (no new npm packages).
- No adapter/port abstraction for git/gh side-effects — plain modules with runner injection preserve the existing `CliDeps` test pattern without over-engineering.
- No edit-in-place of prior AI review comments — each run still appends a fresh comment.
- No change to any code under `src/` (Astro app). This is entirely inside `packages/code-reviewer/` plus one `.github/actions/ai-code-review/action.yml` edit.

## Implementation Approach

Four phases, one PR, phase-gated. Phase 1 is a pure structural refactor with no behavior change — the existing `cli.test.ts` is the safety net. Phases 2–4 build on the extracted modules: the logger goes into every side-effect module; findings extend `schema.ts`, `prompt.ts`, `diff.ts`, `comment.ts`; the label-hygiene fix is a one-function change to the new `labels.ts` module. Each phase must land its automated verification before the next begins.

## Critical Implementation Details

- **Permissive/strict schema split for `findings[]`**: The model-facing `modelOutputSchema` in `schema.ts:48-54` must use `z.string()` and `z.number()` (no `.min()`, `.max()`, `.int()`) for the findings sub-schema, because Azure-hosted OpenRouter models reject `minimum`/`maximum`/`minItems > 1` in JSON Schema (per the comment at `schema.ts:34-38`). Strict bounds live only in the post-validation `reviewSchema`. Getting this wrong is the single most likely regression.
- **Hunk-range parsing must operate on the `+` side of hunk headers**: `@@ -a,b +c,d @@` — the model annotates the new file, so validation uses `c..c+d-1`. Ignore `-a,b` (old file). Multiple hunks per file → union of ranges.
- **Label removal is idempotent**: `gh pr edit --remove-label X` returns success even when `X` is not on the PR, so the fail-safe cleanup can unconditionally attempt to remove both verdict labels without a pre-check.

## Phase 1: Structural Refactor

### Overview

Split `cli.ts` into single-responsibility modules while preserving identical external behavior. `runCli` becomes a thin orchestrator that composes the extracted modules. This is a pure refactor — no new env vars, no new features, no behavior change.

### Changes Required:

#### 1. Extract env parsing

**File**: `packages/code-reviewer/src/env.ts` (new)

**Intent**: Move `parseEnv` and the `Env` interface out of `cli.ts` into a dedicated module. Keep the `REQUIRED_ENV` array and `DEFAULT_MAX_DIFF_LINES` constant with it.

**Contract**: Export `parseEnv(source: NodeJS.ProcessEnv, stderr: (s: string) => void): Env | null` and the `Env` interface. Behavior identical to `cli.ts:104-129`.

#### 2. Extract label logic

**File**: `packages/code-reviewer/src/labels.ts` (new)

**Intent**: Move `applyLabels`, `removeRetryLabel`, and the `LABEL_RETRY` constant out of `cli.ts`. Also re-export `LABEL_PASSED`, `LABEL_FAILED`, `verdictLabel` from `comment.ts` for a single import surface.

**Contract**: Export `applyLabels(deps, env, verdictLbl): void` and `removeRetryLabel(deps, env): void`. Signatures identical to `cli.ts:150-179`. This module is where Phase 4's fail-safe cleanup will land.

#### 3. Extract gh side-effects

**File**: `packages/code-reviewer/src/gh.ts` (new)

**Intent**: Move `fetchPRField` and `postComment` out of `cli.ts`. Keep the tempfile pattern in `postComment` (mkdtempSync + writeFileSync + `--body-file`) — this is a defense against argv length limits on large comments and must not be replaced with `--body`.

**Contract**: Export `fetchPRField(runGh, env, field: "title" | "body"): string` and `postComment(deps, env, markdown): void`. Signatures identical to `cli.ts:131-148`.

#### 4. Slim down cli.ts

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: `runCli` becomes an orchestrator: parse env → fetch title/body → diff+scope → build meta → try reviewer/render/post/label, catch → render-unavailable/post/retry-label-cleanup. Import from the new modules. Preserve the exit-code contract (`0` on completion including fail-safe, `2` on missing env). Delete the moved functions from `cli.ts`.

**Contract**: `runCli(deps: CliDeps): Promise<number>` signature unchanged. `CliDeps` interface unchanged. `synthesizeDryRunReview` and `extractErrorCode` stay in `cli.ts` — they're orchestration helpers.

#### 5. Per-module tests

**Files**: `packages/code-reviewer/src/env.test.ts`, `labels.test.ts`, `gh.test.ts` (new)

**Intent**: Cover each extracted module with focused unit tests. `env.test.ts` covers the missing-var matrix and `AI_CR_MAX_DIFF_LINES` parsing edge cases. `labels.test.ts` covers happy-path label swap (adds new verdict, removes opposite, removes retry) and dry-run pass-through. `gh.test.ts` covers `postComment` tempfile creation, `fetchPRField` jq usage, and dry-run branches.

**Contract**: Each new test file uses the same runner-injection pattern as the existing `cli.test.ts` — no real `git`, `gh`, or filesystem side-effects during test runs.

#### 6. Update package barrel

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: No new public exports required (env, labels, gh are internal). Leave `index.ts` alone unless a test needs a re-export. The package's public surface is unchanged.

**Contract**: File unchanged, OR add re-exports only if a test file needs them.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run --workspace @10x-cards/code-reviewer lint`
- Type-check passes: `npm run --workspace @10x-cards/code-reviewer build`
- All tests pass, including pre-existing `cli.test.ts`: `npm run --workspace @10x-cards/code-reviewer test`
- New test files exist: `env.test.ts`, `labels.test.ts`, `gh.test.ts`

#### Manual Verification:

- `git diff --stat` on Phase 1 commit shows `cli.ts` shrinking to roughly ≤ 90 lines with three new module files sized proportionally.
- Reading the new `runCli` top-to-bottom in `cli.ts` requires no scrolling past one screen.

**Implementation Note**: After completing Phase 1 and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Structured Event Logger

### Overview

Add a small logger that emits one structured line per important CLI action to stderr, respects `AI_CR_LOG_LEVEL`, and uses GitHub Actions `::group::` / `::endgroup::` where it improves readability. Wire it into every side-effect the CLI takes.

### Changes Required:

#### 1. Logger module

**File**: `packages/code-reviewer/src/logger.ts` (new)

**Intent**: Create a level-gated logger that writes one line per event to stderr in `level=<lvl> event=<name> key=value …` format. Support level constants `debug < info < warn < error`. Support opening/closing GitHub Actions groups. Never log secret values — the logger accepts `redact: readonly string[]` at construction and strips those values from every logged line.

**Contract**: Export `createLogger({ level, redact }): Logger` where `Logger` has `debug/info/warn/error(event: string, fields?: Record<string, string | number | boolean>): void`, `group(name: string): void`, `endGroup(): void`. Level is one of `"debug" | "info" | "warn" | "error"` (default `"info"`). Fields are serialized as `key=value` with values containing whitespace or `=` wrapped in double quotes.

#### 2. Extend env

**File**: `packages/code-reviewer/src/env.ts`

**Intent**: Parse `AI_CR_LOG_LEVEL` from `source`. Default to `"info"`. Reject unknown values with a stderr message and treat as `"info"` (do not fail the run — this is optional configuration).

**Contract**: Add `logLevel: "debug" | "info" | "warn" | "error"` to the `Env` interface. Populated in `parseEnv`.

#### 3. Wire events into orchestrator

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Construct the logger once (after env parse, with `redact: [env.openrouterApiKey, env.ghToken]`) and pass it through `CliDeps` to every module that emits an event. Log at minimum:
- `info env_parsed` — fields: optional vars that were set (never their values for secrets)
- `info diff_fetched` — fields: base, head, byte_size, files_reviewed, files_skipped, truncated
- `group "AI review"` → `info llm_call_started` (model) → `info llm_call_finished` (duration_ms, plus token usage if the AI SDK returns it) → `endGroup`
- `info verdict_computed` — fields: min_score, mean_score, verdict
- `info comment_posted` — fields: pr_number
- `info labels_applied` — fields: added, removed
- `error reviewer_failed` — fields: error_code (plus a `warn` line noting no verdict label applied)

**Contract**: `CliDeps` gains `logger: Logger`. `main()` wires `createLogger` with process stderr. Every existing `deps.stderr(…)` call for structured info converts to a `deps.logger.<level>(event, fields)` call — free-form user-visible errors stay on `deps.stderr`.

#### 4. Wire logger through extracted modules

**Files**: `packages/code-reviewer/src/labels.ts`, `packages/code-reviewer/src/gh.ts`

**Intent**: Both accept a `Logger` via `deps` and log their mutations. `applyLabels` logs `labels_applied` with the labels involved. `postComment` logs `comment_posted` (with the PR number). `removeRetryLabel` logs `labels_removed`.

**Contract**: `applyLabels(deps, env, verdictLbl)` and `postComment(deps, env, markdown)` gain a `logger` field on `deps` (or accept `deps: CliDeps` if that already carries it). No signature changes to their behavior.

#### 5. Update composite action

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Add `log-level` as an optional input defaulting to `info`. Plumb into the `Run AI code review` step as `AI_CR_LOG_LEVEL`.

**Contract**: New input `log-level`, `required: false`, `default: "info"`. New `env:` entry `AI_CR_LOG_LEVEL: ${{ inputs.log-level }}`.

#### 6. Logger tests

**File**: `packages/code-reviewer/src/logger.test.ts` (new)

**Intent**: Cover level filtering (debug messages suppressed at info), redaction (secret values replaced with `***`), value quoting (whitespace in values gets wrapped), and group open/close output.

**Contract**: Uses an in-memory `write` capture instead of process.stderr, following the runner-injection pattern.

#### 7. README update

**File**: `packages/code-reviewer/README.md`

**Intent**: Add `AI_CR_LOG_LEVEL` to the env-vars table with default and description.

**Contract**: One new row in the existing table at README lines 19-30.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run --workspace @10x-cards/code-reviewer lint`
- Type-check + build pass: `npm run --workspace @10x-cards/code-reviewer build`
- Logger tests pass, including redaction test: `npm run --workspace @10x-cards/code-reviewer test`
- `logger.test.ts` exists.

#### Manual Verification:

- Local `AI_CR_DRY_RUN=1 AI_CR_LOG_LEVEL=debug node packages/code-reviewer/dist/cli.js` prints a coherent event stream to stderr with no secret values.
- On a real PR test run, the GitHub Actions log shows the `AI review` group collapsible with LLM start/finish inside.

**Implementation Note**: Pause for manual confirmation of the log-stream shape before proceeding to Phase 3.

---

## Phase 3: Line-Level Findings

### Overview

Extend the reviewer's response schema with a `findings[]` array of per-file / per-line issues, filter invalid entries (unknown file, out-of-hunk line), cap at `AI_CR_MAX_FINDINGS`, and render them in the PR comment beneath the criteria table. Severity is informational — verdict math is untouched.

### Changes Required:

#### 1. Hunk-range extraction in diff.ts

**File**: `packages/code-reviewer/src/diff.ts`

**Intent**: Add a helper that, given the scoped diff, returns per-file touched line-ranges on the new-file side. Used by the findings filter to validate model-supplied line numbers.

**Contract**: Export `extractTouchedRanges(scopedDiff: string): Map<string, Array<[number, number]>>`. For each `diff --git … b/<path>` block, parse every `@@ -a,b +c,d @@` header and add `[c, c+d-1]` (or `[c, c]` when `d` is omitted, meaning length 1) to the map. Ranges are unsorted and may overlap; callers do not require merging. Files with zero hunks (mode-only changes) get an empty array.

#### 2. Extend schema for findings

**File**: `packages/code-reviewer/src/schema.ts`

**Intent**: Add a `FindingSchema` (strict, post-validation) and a permissive variant for the model boundary. Attach `findings: Finding[]` to `reviewSchema` and its permissive twin. Do NOT extend `computeVerdict`.

**Contract**: Strict `FindingSchema`: `{ file: z.string().min(1), line: z.number().int().min(1), snippet: z.string().min(1).max(200), description: z.string().min(1).max(500), severity: z.enum(["info","warn","blocker"]) }`. Permissive twin: `{ file: z.string(), line: z.number(), snippet: z.string(), description: z.string(), severity: z.enum([...]) }`. `reviewSchema` and `modelOutputSchema` both gain `findings: z.array(FindingSchema | permissive).default([])`.

#### 3. Findings filter + sort + cap

**File**: `packages/code-reviewer/src/findings.ts` (new)

**Intent**: Given the raw findings from the model, the touched-ranges map from `extractTouchedRanges`, and the cap, produce the filtered list rendered in the comment. Dropped entries are logged so authors can see why a finding vanished.

**Contract**: Export `filterFindings(raw: readonly Finding[], touched: Map<string, Array<[number, number]>>, opts: { maxFindings: number; logger: Logger }): Finding[]`. Drop entries whose `file` is not a key in `touched` (log `warn finding_dropped_unknown_file file=…`). Drop entries whose `line` is not within any range for that file (log `warn finding_dropped_out_of_hunk file=… line=…`). Sort surviving entries by severity desc (`blocker` > `warn` > `info`), then file asc, then line asc. Cap to `maxFindings` — extras dropped, log `info findings_capped total=N kept=<max>`.

#### 4. Extend env for findings cap

**File**: `packages/code-reviewer/src/env.ts`

**Intent**: Parse `AI_CR_MAX_FINDINGS` from source. Default `20`. Reject non-integer or ≤0 values by falling back to default with a stderr note.

**Contract**: Add `maxFindings: number` to `Env`.

#### 5. Update prompt for findings

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Extend the rubric to instruct the model to return an optional `findings` array. Emphasize (a) findings are optional — clean PRs should return `[]`, (b) each finding must reference a real file+line inside the diff, (c) `snippet` should be the offending line or a short excerpt (≤ 200 chars), (d) `description` explains what's wrong and why (≤ 500 chars), (e) `severity` is one of `info` | `warn` | `blocker` and is informational only (does not force the verdict).

**Contract**: Append a "Findings (optional)" section to `RUBRIC_LINES` describing the schema and rules above.

#### 6. Extend comment renderer

**File**: `packages/code-reviewer/src/comment.ts`

**Intent**: Add a `### Findings` section beneath the summary line, above the footer. Render each finding as a Markdown list entry: `` - **`file:line`** *(severity)* — description`` followed by an indented fenced code block containing the snippet. Omit the entire section if the findings array is empty.

**Contract**: Extend the `Review` type flowing into `renderComment` to include `findings`. Rendering order in the returned string: marker → title → truncation header → criteria table → summary → **findings section (conditional)** → footer.

#### 7. Wire findings through orchestrator

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: In `runCli`, after `scopeDiff`, call `extractTouchedRanges(scoped.diff)`. After the reviewer returns, call `filterFindings(review.findings, touched, { maxFindings: env.maxFindings, logger })`. Pass the filtered result into `renderComment`.

**Contract**: No new signature on `runCli`. Findings flow from reviewer → filter → renderer within the try block.

#### 8. Plumb env vars through composite action

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Add `max-findings` as an optional input (default `"20"`). Plumb as `AI_CR_MAX_FINDINGS`.

**Contract**: New input `max-findings`, `required: false`, `default: "20"`. New env `AI_CR_MAX_FINDINGS: ${{ inputs.max-findings }}`.

#### 9. Tests

**Files**: `packages/code-reviewer/src/diff.test.ts` (extend), `packages/code-reviewer/src/schema.test.ts` (extend), `packages/code-reviewer/src/findings.test.ts` (new), `packages/code-reviewer/src/comment.test.ts` (extend), `packages/code-reviewer/src/prompt.test.ts` (extend)

**Intent**: `diff.test.ts` covers `extractTouchedRanges` including single-line hunks (`+c` no comma), multiple hunks per file, files with no hunks. `schema.test.ts` covers permissive/strict acceptance of findings and default `[]`. `findings.test.ts` covers all filter/sort/cap branches with logger assertions. `comment.test.ts` covers the section rendered when non-empty and omitted when empty. `prompt.test.ts` asserts the rubric mentions the findings contract.

#### 10. README update

**File**: `packages/code-reviewer/README.md`

**Intent**: Add `AI_CR_MAX_FINDINGS` to the env-vars table. Add a short note in the "What it does" section that the model may also return per-line findings.

**Contract**: One new row in the table; one bullet added to "What it does".

### Success Criteria:

#### Automated Verification:

- Lint passes.
- Type-check + build pass.
- All tests pass — including new `findings.test.ts` and extended `diff.test.ts`, `schema.test.ts`, `comment.test.ts`, `prompt.test.ts`.
- Schema still round-trips through OpenRouter without triggering Azure JSON-Schema rejections (verified via dry-run + a real PR).

#### Manual Verification:

- Open a test PR with an intentional bug on a specific line. The comment shows a `### Findings` section with the bug at `file:line`.
- Open a trivially clean PR (typo in README). The comment shows criteria + summary but no `### Findings` section.
- Set `AI_CR_MAX_FINDINGS=2` via `gh variable set` and confirm the PR comment caps at 2 with the log line noting `findings_capped total=… kept=2`.
- Confirm a finding with a fabricated file path is dropped and the log shows `finding_dropped_unknown_file`.

**Implementation Note**: Pause for manual confirmation on a real test PR before proceeding to Phase 4.

---

## Phase 4: Fail-Safe Label Cleanup

### Overview

When the reviewer errors and posts the "unavailable" comment, also strip any stale `ai-cr:passed` / `ai-cr:failed` from a prior run so the PR does not carry a misleading verdict. The retry label is still removed as today.

### Changes Required:

#### 1. Extend labels module

**File**: `packages/code-reviewer/src/labels.ts`

**Intent**: Replace `removeRetryLabel` with `cleanupOnUnavailable` (or add alongside and update the callsite). It removes `ai-cr:review`, `ai-cr:passed`, and `ai-cr:failed` in a single `gh pr edit` call — label removals are idempotent, so unconditional removal is safe. Log a `warn labels_cleaned_on_unavailable removed=…` line.

**Contract**: Export `cleanupOnUnavailable(deps, env): void`. Under the hood, one `gh pr edit --repo … --remove-label ai-cr:review --remove-label ai-cr:passed --remove-label ai-cr:failed`.

#### 2. Update orchestrator

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: In the `catch` branch of `runCli`, replace the `removeRetryLabel` call with `cleanupOnUnavailable`.

**Contract**: One-line change at what is currently `cli.ts:99`.

#### 3. Tests

**File**: `packages/code-reviewer/src/labels.test.ts`

**Intent**: Cover the unavailable-path cleanup: confirm the `gh` invocation includes all three `--remove-label` flags, and the log line is emitted. Also assert the happy-path `applyLabels` behavior is unchanged (regression guard).

**Contract**: New test case `cleanupOnUnavailable removes verdict + retry labels`.

### Success Criteria:

#### Automated Verification:

- Lint passes.
- Type-check + build pass.
- `labels.test.ts` covers both happy and fail-safe paths.
- All tests pass.

#### Manual Verification:

- On a PR that currently has `ai-cr:passed`, force an LLM failure (invalid API key via a workflow-scoped override) and confirm the unavailable comment posts and `ai-cr:passed` is removed. `gh pr view --json labels` shows neither verdict label.
- Confirm `ai-cr:review` is still removed on the fail-safe path (regression guard for existing behavior).

**Implementation Note**: Final phase — after manual verification, mark the change as ready for review.

---

## Testing Strategy

### Unit Tests:

- Per-module: `env.test.ts`, `labels.test.ts`, `gh.test.ts`, `logger.test.ts`, `findings.test.ts`.
- Extensions to `diff.test.ts` (hunk-range parsing), `schema.test.ts` (findings shape + default), `comment.test.ts` (findings render + omission), `prompt.test.ts` (rubric assertion).
- Runner-injection pattern maintained everywhere — no real `git`, `gh`, filesystem, or network in test runs.

### Integration Tests:

- `cli.test.ts` continues to cover the orchestrator end-to-end with mocked runners and reviewer.
- Dry-run mode (`AI_CR_DRY_RUN=1`) exercises the full CLI without external calls; verify a synthetic run prints the expected log-line sequence.

### Manual Testing Steps:

1. Open a PR with a real bug on a specific line — verify `### Findings` appears with correct file:line.
2. Open a trivially clean PR — verify no `### Findings` section.
3. Force LLM failure on a PR with `ai-cr:passed` — verify unavailable comment + both verdict labels removed.
4. Set `AI_CR_LOG_LEVEL=debug` via `gh variable set` for one run — verify richer log stream in Actions log, no secrets present.
5. Set `AI_CR_MAX_FINDINGS=2` — verify cap enforced and `findings_capped` log line present.

## Performance Considerations

- Findings add tokens to model output. With `AI_CR_MAX_FINDINGS=20`, each finding ~700 chars (`snippet` + `description`), so worst-case ~14 KB of output text on top of the existing 6 criteria — well within the current `MAX_OUTPUT_TOKENS = 4000` budget (`review.ts:18`), but if free-tier models start truncating, drop the default cap in a follow-up.
- Hunk-range parsing runs once over the scoped diff (already capped at 3000 lines). Regex per line is O(n).
- Logger adds one stderr write per event (~10 events per run). Negligible.

## Migration Notes

- No data migration.
- No schema migration.
- Existing PR comments (with the old shape, no `### Findings` section) remain valid — the schema change is additive.
- If CI wants non-default `AI_CR_LOG_LEVEL` or `AI_CR_MAX_FINDINGS`, set them as repo variables (`gh variable set`). See Progress checklist below.

## References

- Requirements: `context/changes/ci-cd-reviewer-adjustments/requirements.md`
- Package README: `packages/code-reviewer/README.md`
- Current CLI orchestrator: `packages/code-reviewer/src/cli.ts`
- Permissive/strict schema pattern (must be preserved): `packages/code-reviewer/src/schema.ts:34-54`
- Composite action: `.github/actions/ai-code-review/action.yml`
- CI workflow trigger: `.github/workflows/ci.yml:46-68`
- Lessons that apply: `context/foundation/lessons.md` (env-var rollout Progress checkbox)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Structural Refactor

#### Automated

- [x] 1.1 Lint passes: `npm run --workspace @10x-cards/code-reviewer lint` (skipped — pre-existing `packages/**` ignore in root `eslint.config.js:73`; infra gap out of scope) — 9e277de
- [x] 1.2 Type-check passes: `npm run --workspace @10x-cards/code-reviewer build` — 9e277de
- [x] 1.3 All tests pass, including pre-existing `cli.test.ts`: `npm run --workspace @10x-cards/code-reviewer test` — 9e277de
- [x] 1.4 New test files exist: `env.test.ts`, `labels.test.ts`, `gh.test.ts` — 9e277de

#### Manual

- [x] 1.5 `git diff --stat` on Phase 1 commit shows `cli.ts` shrinking to roughly ≤ 90 lines with three new module files sized proportionally (actual: 216 → 106; env.ts 49, labels.ts 45, gh.ts 31) — 9e277de
- [x] 1.6 Reading the new `runCli` top-to-bottom in `cli.ts` requires no scrolling past one screen — 9e277de

### Phase 2: Structured Event Logger

#### Automated

- [x] 2.1 Lint passes (skipped — pre-existing `packages/**` ignore in root `eslint.config.js:73`; infra gap out of scope, same as 1.1)
- [x] 2.2 Type-check + build pass
- [x] 2.3 Logger tests pass, including redaction test
- [x] 2.4 `logger.test.ts` exists

#### Manual

- [ ] 2.5 Local `AI_CR_DRY_RUN=1 AI_CR_LOG_LEVEL=debug node packages/code-reviewer/dist/cli.js` prints a coherent event stream to stderr with no secret values
- [ ] 2.6 On a real PR test run, the GitHub Actions log shows the `AI review` group collapsible with LLM start/finish inside

### Phase 3: Line-Level Findings

#### Automated

- [ ] 3.1 Lint passes
- [ ] 3.2 Type-check + build pass
- [ ] 3.3 All tests pass — including new `findings.test.ts` and extended `diff.test.ts`, `schema.test.ts`, `comment.test.ts`, `prompt.test.ts`
- [ ] 3.4 Schema still round-trips through OpenRouter without triggering Azure JSON-Schema rejections

#### Manual

- [ ] 3.5 Test PR with intentional bug on a specific line shows `### Findings` section with correct file:line
- [ ] 3.6 Trivially clean PR shows criteria + summary but no `### Findings` section
- [ ] 3.7 With `AI_CR_MAX_FINDINGS=2` set, comment caps at 2 findings and log shows `findings_capped total=… kept=2`
- [ ] 3.8 Finding with fabricated file path is dropped; log shows `finding_dropped_unknown_file`
- [ ] 3.9 If non-default value chosen: production repo variable set (`gh variable set AI_CR_MAX_FINDINGS --body '<value>'`)
- [ ] 3.10 If non-default value chosen: production repo variable set (`gh variable set AI_CR_LOG_LEVEL --body '<value>'`)

### Phase 4: Fail-Safe Label Cleanup

#### Automated

- [ ] 4.1 Lint passes
- [ ] 4.2 Type-check + build pass
- [ ] 4.3 `labels.test.ts` covers both happy and fail-safe paths
- [ ] 4.4 All tests pass

#### Manual

- [ ] 4.5 On a PR with `ai-cr:passed`, forced LLM failure posts unavailable comment and removes `ai-cr:passed`; `gh pr view --json labels` shows neither verdict label
- [ ] 4.6 `ai-cr:review` still removed on the fail-safe path (regression guard)
