# CI/CD Code-Reviewer Adjustments — Plan Brief

> Full plan: `context/changes/ci-cd-reviewer-adjustments/plan.md`
> Requirements: `context/changes/ci-cd-reviewer-adjustments/requirements.md`

## What & Why

Extend `packages/code-reviewer` (the AI-driven PR reviewer) with a modest structural refactor, a structured event logger, per-line findings in the PR comment, and a fix for stale verdict labels on the fail-safe path. The reviewer works today, but a 216-line `cli.ts` is hard to extend, there is no visible trail of what happened on a run, PR authors get scores without pointers to specific lines, and a failed review after a passing one leaves a misleading green label.

## Starting Point

`packages/code-reviewer` ships a working end-to-end reviewer: reads `git diff base…head`, calls OpenRouter via the Vercel AI SDK against a Zod-validated 6-criteria schema, posts a Markdown comment, and applies `ai-cr:passed` / `ai-cr:failed`. Comments include criteria + summary but no line-level findings. `cli.ts` mixes env parsing, git/gh side-effects, and orchestration. The happy path clears the opposite verdict label; the error path only clears the retry label.

## Desired End State

`packages/code-reviewer` is organized into single-responsibility modules; every important CLI action emits a structured stderr line (grouped for GitHub Actions readability); PR comments include a `### Findings` section beneath the criteria table listing per-file / per-line issues when the model returned valid ones (omitted when it did not); and errored review runs strip stale `ai-cr:passed` / `ai-cr:failed` in addition to `ai-cr:review`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Restructure aggressiveness | Moderate — extract `env.ts`, `labels.ts`, `gh.ts`, keep `runCli` as orchestrator | Delivers on "better structured" without over-engineering; matches existing per-module test convention | Plan |
| Severity → verdict coupling | Informational only — verdict math unchanged | Keeps deterministic verdict trustworthy; free-tier models produce noisy findings that shouldn't force fails | Plan |
| Findings-in-prompt policy | Optional — empty array allowed | Matches natural signal (clean PRs shouldn't manufacture findings); requirements already say section is omitted when empty | Plan |
| Delivery cadence | One PR, phase-gated | Phases interact (logger + findings both depend on the restructure); one PR keeps them consistent | Plan |
| Comment marker bump | Keep `v1` (no bump) | Comments are appended, not edited — marker is currently inert, so bumping has no functional effect | Plan |
| Log format | Human-readable `key=value`, not JSON | GitHub Actions logs are read by humans; JSON adds noise without a downstream consumer | Requirements |
| New env vars | `AI_CR_LOG_LEVEL` (default `info`), `AI_CR_MAX_FINDINGS` (default `20`) | Optional with safe defaults; non-default values need `gh variable set` | Requirements |
| Findings schema shape | `file` + `line` + `snippet` + `description` + `severity` (`info` / `warn` / `blocker`) | Enough context for authors; capped sizes keep token budget manageable | Requirements |
| Line-in-hunk validation | Parse `@@ -a,b +c,d @@` on the `+` side | Model annotates the new file — that is the authoritative side | Plan |

## Scope

**In scope:**
- Split `cli.ts` into `env.ts`, `labels.ts`, `gh.ts` (+ tests each)
- New `logger.ts` with level-gated stderr output, GH-Actions grouping, and secret redaction
- New `findings.ts` filter/sort/cap module
- Extend `diff.ts` with hunk-range extraction on the new-file side
- Extend `schema.ts` (permissive + strict) and `prompt.ts` for findings
- Extend `comment.ts` with `### Findings` section (omitted when empty)
- Fix `cli.ts` error-path to strip stale verdict labels
- Update `.github/actions/ai-code-review/action.yml` with `log-level` and `max-findings` inputs
- Update `packages/code-reviewer/README.md` env-vars table

**Out of scope:**
- Deterministic verdict rule changes (severity is informational only)
- Any change to the six review criteria or their prompt rubric
- Happy-path label logic changes (already correct)
- Comment marker version bump
- Workflow trigger changes (`ci.yml` untouched)
- New npm packages
- Any code under `src/` (Astro app) — this change is entirely inside `packages/code-reviewer/` plus one `action.yml` edit
- Edit-in-place of prior AI review comments

## Architecture / Approach

`cli.ts` becomes a thin orchestrator that composes small modules: `env` → `logger` → `diff.scopeDiff` → `diff.extractTouchedRanges` → `review.reviewPR` → `findings.filterFindings` → `comment.renderComment` → `gh.postComment` → `labels.applyLabels` (or `labels.cleanupOnUnavailable` on error). Every side-effecting module accepts a `Logger` via `CliDeps` for testable event emission. The findings addition preserves the existing permissive/strict schema pattern that keeps Azure-hosted OpenRouter models happy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Structural refactor | `cli.ts` split into env/labels/gh modules with per-module tests | Regressing existing behavior — mitigated by keeping `cli.test.ts` untouched as the safety net |
| 2. Structured event logger | Level-gated stderr events wired through every side-effect module + composite-action input | Accidentally logging secrets — mitigated by required `redact` on logger construction |
| 3. Line-level findings | New schema field, hunk-range parser, filter/sort/cap, comment section, prompt update | Azure JSON-Schema rejection if permissive/strict split is bypassed |
| 4. Fail-safe label cleanup | Error-path removes stale verdict labels in addition to retry label | Very low — one function call swap, idempotent gh operation |

**Prerequisites:** None. Access to a test PR in this repo is enough to exercise the manual verification steps.
**Estimated effort:** ~1–2 sessions across 4 phases; one PR.

## Open Risks & Assumptions

- Free-tier OpenRouter models may under-produce findings when told "optional" — first real PR run will show the actual behavior; if needed, a prompt-tuning follow-up can nudge without changing schema.
- Free-tier output-token budget is 4000 (`review.ts:18`). With `AI_CR_MAX_FINDINGS=20` worst-case ~14 KB findings text, we sit inside the budget, but if we see truncation the default cap drops in a follow-up.
- Assumption: `gh pr edit --remove-label X` is idempotent (safe on labels not currently applied). If a `gh` upgrade changes this, Phase 4 fails visibly and gets caught in manual verification.

## Success Criteria (Summary)

- Opening a PR with a real bug produces a comment whose `### Findings` section points to the specific file and line.
- Opening a trivially clean PR produces a comment with no `### Findings` section (no manufactured noise).
- Forcing an LLM failure on a PR that had `ai-cr:passed` strips the stale green label along with the retry label.
- GitHub Actions logs show a structured, grouped, secret-free event stream from every reviewer run.
