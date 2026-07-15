## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

1) **implementation correctness** — Does the code actually do what the PR claims, handling the stated inputs, edge cases, and failure modes without introducing regressions?
   - 1: broken or wrong — fails the stated intent, mishandles obvious inputs, or breaks existing behavior.
   - 10: provably correct — intent is met end-to-end, edge cases and failure modes are handled deliberately.

2) **idiomaticity** — Does the change follow the language, framework, and repository conventions a fluent reader of this codebase would expect?
   - 1: alien to the codebase — ignores established patterns, reinvents built-ins, or fights the framework.
   - 10: reads like the rest of the repo — a maintainer would have written it the same way.

3) **complexity** — Is the change as simple as it can be for what it delivers, without unnecessary abstraction, indirection, or scope creep?
   - 1: over-engineered or tangled — abstractions, layers, or scope that the task does not justify.
   - 10: minimal and direct — every line earns its place; nothing simpler would still work.

4) **test / risk coverage** — Are the behaviors and failure modes introduced or touched by this change verified in proportion to their risk?
   - 1: untested where it matters — risky logic ships with no meaningful verification.
   - 10: risk-proportionate coverage — critical paths and failure modes have targeted, trustworthy tests.

5) **documentation** — Are the non-obvious "whys," public interfaces, and operational concerns explained where a future reader will actually look?
   - 1: opaque — non-obvious decisions, interfaces, or ops concerns left unexplained.
   - 10: self-explanatory — the "why," public surface, and operational notes are captured where readers will find them.

6) **security and safety** — Does the change avoid introducing vulnerabilities, unsafe data handling, or unsafe operational behaviors given its blast radius?
   - 1: unsafe — introduces a vulnerability, leaks sensitive data, or performs a destructive action without safeguards.
   - 10: defense-in-depth — inputs, secrets, permissions, and side effects are handled safely for the change's blast radius.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added