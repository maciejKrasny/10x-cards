---
change_id: ui-improvements
status: in-progress
type: ux-review
created: 2026-06-17
owner: maciej.krasny@gft.com
---

# UI/UX Review — 10xCards

Running design review session. Each markdown file in this folder captures recommendations for one screen / area of the product. Entries are added as the user and reviewer agree on changes during the session, and are kept implementation-ready for a future `/10x-plan` pass.

## How this folder is organized

- `README.md` (this file) — index + global session context
- `_global.md` — cross-cutting recommendations (design system, navigation, accessibility, copy)
- `<screen-slug>.md` — one file per screen reviewed (e.g. `signin.md`, `generate.md`, `decks-index.md`, `deck-detail.md`, `study-session.md`)
- `_open-questions.md` — unresolved questions surfaced during the review that need user input before they can be turned into recommendations

Each screen file uses the same structure:

```markdown
# <Screen name> (`<route>`)

## Purpose
What the screen is for and where it sits in the user journey.

## Issues identified
- **[H/M/L] Title** — what's wrong, why it creates friction.

## Recommendations
- **[H/M/L] Title** — what to change. Options A/B/C when applicable. Approved: yes/no.

## Missing states / edge cases
- ...

## Implementation notes
- File paths, components touched, copy strings, etc. — only filled in once a recommendation is approved.
```

Priority labels: **H** (high) ship-blockers for the wedge or primary success criterion; **M** (medium) friction or polish that meaningfully helps; **L** (low) nice-to-have / consistency.

## Screens reviewed

_(updated as the session progresses)_

| Status | Screen | File |
|--------|--------|------|
| **approved, implementation-ready** (Recs 1–4, 7); Recs 5–6 pending | Generate (`/generate`) | [generate.md](generate.md) |
| recs drafted, pending approval | Deck detail (`/decks/[id]`) | [deck-detail.md](deck-detail.md) |

## Session ground rules

- All UI copy in English (per user preference; overrides AGENTS.md Polish line).
- Single-deck-per-user is MVP — but git status shows `decks/index` and `decks/[id]` exist, so a deck list is now in play. Confirm with user whether named decks are now in scope.
- Recommendations should respect MVP boundaries from `context/foundation/prd.md` (no multi-format import, no sharing, no native mobile, no password reset).
- Wedge to protect at all costs: paste-to-deck-to-study latency. Anything that adds steps before the first generated card needs a strong justification.
