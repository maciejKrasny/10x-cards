## Overall concept

Extend the existing `packages/code-reviewer` CI/CD reviewer with (a) clearer
internal structure, (b) explicit logs of the important actions the CLI takes,
(c) richer PR comments that call out specific findings by file + line, and
(d) tighter label hygiene when the verdict flips or the run fails.

Non-goal: no change to how the reviewer is triggered (same workflow, same
labels, same happy path). No new secrets.

## Input parameters

Existing env vars (see `packages/code-reviewer/README.md`) are unchanged.

Optional additions (all with safe defaults):

- `AI_CR_LOG_LEVEL` (default `info`) — `debug` | `info` | `warn` | `error`.
- `AI_CR_MAX_FINDINGS` (default `20`) — cap on structured findings surfaced
  in the PR comment; model may return more, extras are dropped with a log
  line at `info`.

No changes to CLI exit codes or fail-safe behavior.

## Code Review Criteria

Unchanged — the six criteria in `src/prompt.ts` (`implementation_correctness`,
`idiomaticity`, `complexity`, `test_risk_coverage`, `documentation`,
`security_and_safety`) and the deterministic verdict thresholds in
`src/schema.ts` stay as-is.

## Expected behavior

### 1. Better internal structure

- `cli.ts` is split so that env parsing, git/gh side-effects, and orchestration
  live in distinct modules; `runCli` becomes a thin orchestrator.
- No new runtime dependencies. No behavior change other than what is called out
  below.

### 2. Logs of important actions

The CLI writes one structured log line per important action to stderr, using
GitHub Actions grouping (`::group::` / `::endgroup::`) where it improves
readability. "Important actions" are, at minimum:

- env parsed (which optional vars were set; secrets never logged)
- diff fetched (base…head, byte size, files reviewed vs. skipped, whether truncated)
- LLM call started / finished (model id, duration, token usage if provider returns it)
- deterministic verdict computed (min score, mean score, verdict)
- PR comment posted (comment id if `gh` returns one)
- labels applied / removed (which labels, why)
- fail-safe path taken (error code, message; no stack traces with secrets)

Log format: one line per event, `level=<lvl> event=<name> key=value …`. Human
readable; not JSON. Respects `AI_CR_LOG_LEVEL`.

### 3. Richer PR comment — line-level findings

The reviewer's response schema gains a `findings` array. Each finding:

- `file` (string, must match a path in the reviewed diff — else dropped + logged)
- `line` (int ≥ 1, must fall inside a hunk touched by the diff — else dropped + logged)
- `snippet` (string ≤ 200 chars, the offending line or short excerpt)
- `description` (string ≤ 500 chars, what's wrong and why it matters)
- `severity` (`info` | `warn` | `blocker`)

Capped at `AI_CR_MAX_FINDINGS` after filtering; ordered by severity desc, then
file, then line.

Rendered in the PR comment as a new section beneath the criteria table:

```
### Findings

- **`path/to/file.ts:42`** *(warn)* — <description>
  ```ts
  <snippet>
  ```
```

If the model returns zero valid findings, the section is omitted (not left
empty). The `renderUnavailableComment` path is unchanged.

### 4. Label hygiene

- Happy path (unchanged): apply the new verdict label, remove the opposite
  verdict label, remove the retry label. This already works.
- **Fail-safe path (new):** when the reviewer errors and posts the
  "unavailable" comment, also remove any stale `ai-cr:passed` / `ai-cr:failed`
  from a previous run, so the PR does not carry a misleading verdict from an
  earlier commit. The retry label is still removed as today.
- All label mutations are logged (see §2).
