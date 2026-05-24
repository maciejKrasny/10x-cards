# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Never add lodash without explicit reason

- **Context**: Implementation of functions in a TypeScript application (frontend and backend)
- **Problem**: Modern JS/TS (2026+) has native equivalents for most lodash functions — adding it signals the implementer didn't check for built-in alternatives.
- **Rule**: Never add lodash without explicit documented reason. Project prefers native JS/TS functions available in standard 2026+.
- **Applies to**: plan, implement, impl-review
