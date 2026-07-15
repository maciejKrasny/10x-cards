# @10x-cards/code-reviewer

AI-driven pull-request code reviewer. Runs in a GitHub Actions job, scores six named criteria against the PR diff, and posts a Markdown summary comment plus a pass/fail label.

This package is **standalone**: it does not import from the Astro app under `src/`. It runs in a plain Node process during CI and can be invoked locally for development.

## What it does

1. Read the PR diff (`git diff <base>...<head>`), excluding lockfiles, generated files, and minified assets.
2. Truncate at 3000 lines on file boundaries; report which files were reviewed vs skipped.
3. Call an LLM (via `@openrouter/ai-sdk-provider` + Vercel AI SDK `generateObject`) with a Zod-enforced schema of six criteria × 1–10 scores + an overall summary.
4. Compute the pass/fail verdict deterministically from the scores (not from the model's own verdict).
5. Post a Markdown comment + apply `ai-cr:passed` or `ai-cr:failed` label via `gh` CLI.

On any LLM error, post a neutral "review unavailable" comment (no verdict label), so a model outage never blocks a merge.

## Env vars (Phase 2+)

| Name                  | Required | Kind     | Purpose                                                   |
| --------------------- | -------- | -------- | --------------------------------------------------------- |
| `OPENROUTER_API_KEY`  | yes      | secret   | OpenRouter API key                                        |
| `AI_CR_MODEL`         | yes      | variable | Model id, e.g. `google/gemma-4-31b-it:free`               |
| `GH_TOKEN`            | yes      | secret   | GitHub token for `gh` CLI (comment + label side-effects)  |
| `GITHUB_REPOSITORY`   | yes      | variable | `owner/repo` — set by Actions automatically               |
| `PR_NUMBER`           | yes      | variable | PR number to review                                       |
| `BASE_REF`            | yes      | variable | Base branch/ref for `git diff`                            |
| `HEAD_REF`            | yes      | variable | Head SHA for `git diff`                                   |
| `AI_CR_MAX_DIFF_LINES`| no       | variable | Truncation cap in diff-lines (default `3000`)             |
| `AI_CR_DRY_RUN`       | no       | variable | If `1`, print intended `gh` invocations instead of executing them |

## Local development

From the repo root:

```bash
npm ci                                              # installs workspace deps
npm run --workspace @10x-cards/code-reviewer build  # tsc -> dist/
npm run --workspace @10x-cards/code-reviewer test   # vitest
npm run --workspace @10x-cards/code-reviewer lint   # eslint
```

## Exit codes (CLI, Phase 2+)

- `0` — review completed (either a normal review or a fail-safe "unavailable" comment was posted).
- `2` — required env var missing (setup error, not a review outcome).

## Repo setup (one-time)

Before the reviewer can run against a repo, complete these three GitHub-side steps. `OPENROUTER_API_KEY` is a **repo secret** (encrypted, hidden from logs). `AI_CR_MODEL` is a **repo variable** (plain-text, visible in workflow logs — model names are not secret).

```bash
# 1. Secret: OpenRouter API key
gh secret set OPENROUTER_API_KEY

# 2. Variable: model id (free-tier Gemma by default)
gh variable set AI_CR_MODEL --body 'google/gemma-4-31b-it:free'

# 3. Labels (three total — verdicts + retry trigger)
gh label create ai-cr:passed --color 0e8a16
gh label create ai-cr:failed --color d93f0b
gh label create ai-cr:review --color c5def5 --description 'Add to trigger a re-review'
```

Verify with `gh secret list`, `gh variable list`, and `gh label list` before opening a test PR.
