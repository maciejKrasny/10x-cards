# Deck detail (`/decks/[id]`)

## Purpose
Manage saved cards in a deck. Lands here after a successful generate-and-save (after the new review-before-save flow lands), or directly from the Decks list.

## Scope note
User explicitly limited this review to "no other functionality." Recommendations below are consistency / polish only — no new features. Defer freely.

## Issues identified

- **[L] Subtitle "Manage cards in this deck."** — generic, low signal. A live card count would help, but is not strictly needed.
- **[L] Edit and Delete buttons side-by-side, Delete in solid red** — single-click delete on a saved card is risky because saved cards may have review history attached (FSRS state). Misclick destroys progress.
- **[L] Success banner takes a lot of vertical space** — compact single-line variant would free scroll real estate without losing the affordance.
- **[L] Inconsistency with new `DeckRowMenu`** — git status shows a new `DeckRowMenu.tsx` on the decks list. Saved card rows still use side-by-side Edit / Delete buttons.

## Recommendations

### 1. [L] Delete confirmation gate for saved cards

**Approved: pending**

Saved cards carry review history. Add a confirmation step before destructive delete:

- **Option A** — Inline confirm state: clicking Delete swaps the button row to "Confirm delete · Cancel".
- **Option B** — Modal confirmation: "Delete this card? Its review history will be lost."

Recommendation: Option A (lighter, no modal overhead, dismissible by clicking outside or pressing Esc).

### 2. [L] Compact success banner

**Approved: pending**

Reduce to a single line: "8 new cards added · Dismiss". Same green treatment, less vertical real estate. Auto-dismiss after 8 s with a fade-out.

### 3. [L] Mirror the `DeckRowMenu` pattern on card rows

**Approved: pending**

Once `DeckRowMenu` is finalized on the decks list, apply the same kebab-menu pattern (`⋯` → Edit / Delete) to saved card rows for visual consistency. Defer until the decks-list pattern is reviewed and approved.

## Missing states / edge cases

- **Empty deck** — no cards. Show empty state: "This deck has no cards yet. [+ Add card] or [✨ Generate from text]."
- **Deck not owned by user** — middleware should already redirect, but confirm a 404 page is rendered, not a blank deck.

## Implementation notes

_(filled in once recommendations are approved)_

- Files: `src/components/cards/DeckDetailPage.tsx`, `src/components/decks/DeckRowMenu.tsx` (read for pattern reuse).
