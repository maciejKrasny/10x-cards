# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Never add lodash without explicit reason

- **Context**: Implementation of functions in a TypeScript application (frontend and backend)
- **Problem**: Modern JS/TS (2026+) has native equivalents for most lodash functions — adding it signals the implementer didn't check for built-in alternatives.
- **Rule**: Never add lodash without explicit documented reason. Project prefers native JS/TS functions available in standard 2026+.
- **Applies to**: plan, implement, impl-review

## Production env-var rollout needs a Progress checkbox, not prose

- **Context**: Any plan / slice that introduces new production-only env vars or secrets (e.g. `npx wrangler secret put`, dashboard-managed platform env, cloud KMS values).
- **Problem**: Plans that document production env vars only as prose in 'Migration Notes' or a deploy-sequence paragraph get skipped during implementation and impl-review, because the Progress checklist is the canonical source of truth. ai-generate-from-paste returned 502 LLM_FAILURE on first post-deploy paste because OPENROUTER_API_KEY / OPENROUTER_MODEL were never set in production despite being in the plan's prose.
- **Rule**: When a plan introduces any production-only env var or secret, it MUST add a `- [ ]` checkbox under `## Progress` for 'production secret(s) set in target environment (`<command or dashboard step>`)'. Implementation cannot mark the slice complete until that box is ticked. Impl-review must flag a missing rollout checkbox as a Success Criteria warning.
- **Applies to**: plan, plan-review, implement, impl-review
