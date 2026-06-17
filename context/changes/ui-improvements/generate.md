# Generate (`/generate`)

## Purpose
Wedge of the product. Logged-in user pastes a block of text, triggers AI generation, gets a batch of flashcards. After review, the batch is saved to the target deck.

## Major change requested
**Auto-save → review-before-save.** Today, generated cards are written to the database immediately and the user lands on the deck detail page with a green "N new cards added" banner. The new flow keeps the generated cards on the Generate page as a reviewable batch (NOT yet in the database) until the user clicks a Submit button that bulk-saves them.

> Note: this reverses the PRD's Socratic resolution of FR-004 / FR-007 (which chose "auto-save all cards, delete unwanted" over a per-card confirmation gate). The user is the product owner and is explicitly redirecting. The recommendation set below keeps the bulk-save semantic but makes the review state visually unambiguous so the wedge speed-to-deck does not regress.

## Current vs. target behavior

**Anchor for implementers: the existing auto-save path MUST be removed. The target behavior is two distinct user actions (Generate, then Submit) that hit two distinct endpoints.**

| | Current (today, on `feature/ux-improvements`) | Target (after this change) |
|---|---|---|
| **Generate click** | Calls `POST /api/cards/generate` → LLM call **+ DB insert in the same request** (see `src/pages/api/cards/generate.ts` lines 50–68). Returns inserted card rows with DB ids. | Calls `POST /api/cards/generate` → LLM call **only**. Returns generated `{ front, back }` pairs without DB ids. No row in `cards` is created. |
| **Where cards appear** | Redirect to `/decks/[id]` showing the saved cards highlighted with "NEW" badge + green "N new cards added" banner. | Stay on `/generate`. Review list renders inline below the (collapsed) paste form. Cards live only in React state. |
| **DB write moment** | Immediately on Generate click. | Only on Submit click. |
| **Submit endpoint** | n/a — no submit exists. | New `POST /api/cards/bulk` accepting `{ deck_id, cards: [{front, back}, …] }`. Single transactional insert. |
| **Post-save UX** | Already there: redirect to `/decks/[id]` with "N new cards added" banner. | Same as today — preserve the existing success affordance. |
| **Discarding a card the user doesn't want** | DELETE call on a saved row. | In-memory remove from React state. No API call. |
| **Loading phases** | One ("Generate" covers gen + save). | Two: Generate = "Generating…" (LLM only); Submit = "Saving…" (DB write). |

**What this means for the existing code:**

- `src/pages/api/cards/generate.ts` — remove the `insert` block (current lines 57–68). Return the LLM output directly.
- `src/components/cards/PasteToGenerate.tsx` — stop redirecting after Generate. Render the review list inline and hold the batch in component state. Add the Submit button and `beforeunload` listener.
- Add `src/pages/api/cards/bulk.ts` (or co-locate as `POST /api/cards/bulk`) for the transactional bulk insert. Keep the deck-ownership SELECT guard that `generate.ts` uses today (the same scanner-confirmation risk applies).
- `src/pages/api/cards/[id].ts` (per-card DELETE / PATCH) and `src/pages/api/cards/index.ts` per-card insert (used by `+ Add card` on the deck detail page) stay unchanged.

## Issues identified

### Generate form (screenshot 1)

- **[M] Terminology drift** — page title says "cards" but the button says "flashcards" and the placeholder says "flashcards". Pick one and use it everywhere (recommendation: "cards").
- **[M] Loading phases not aligned with the new flow** — today the Generate button covers both "AI generation" and "save to DB" in one phase. After this change, Generate only triggers the LLM call (no DB write); a separate Submit button triggers the bulk save. Each needs its own loading state.
- **[L] Counter unit unstated** — "0 / 6000" does not say characters, tokens, or words. Append the unit: `"0 / 6000 characters"`.
- **[L] Textarea height** — short by default for a 6000-character paste. Increase initial `min-height` and auto-grow as the user types (capped at ~50 vh).
- **[L] Disabled button state is ambiguous** — looks half-disabled. Make disabled visibly disabled (lower opacity, `cursor-not-allowed`) and add a tooltip explaining why.
- **[L] "Manage decks →" link placement** — sits next to a control the user will tap to *swap* decks. Either move it out of the form area or fold it into the Decks topbar entry.

### Review list (new screen)

Does not exist yet. See Recommendation 1.

## Recommendations

### 1. [H] Add a review-before-save flow (inline on `/generate`)

**Approved: yes — Option A (inline) with `beforeunload` warning; no `localStorage` persistence.**

When the user clicks Generate:

1. Show loading state on the Generate button ("Generating…") + skeleton placeholders for the review list area (satisfies NFR-1 acknowledgement window). No DB write happens in this phase.
2. When the response arrives, replace skeletons with the **review list** of the generated cards. Each card shows FRONT / BACK and per-card actions: **Edit** (inline) and **Discard** (removes from the batch). Cards have no per-card status badge — the whole page IS the review state.
3. Above and below the list, a primary action: **"Save N cards to <deck name>"** — the count updates live as the user discards cards.
4. Secondary action: **"Discard all"** — clears the batch, keeps the user on `/generate` with the paste preserved so they can re-generate with the same input or edit it.
5. On Submit → call `POST /api/cards/bulk`, show the Submit-button loading state ("Saving…"), then redirect to `/decks/[id]` and show the existing "N new cards added" banner. (Preserves the established success pattern.)

**Refresh / nav safety:** native browser `beforeunload` prompt when there are unsaved cards in the review list. No `localStorage` persistence — accepting loss on refresh.

**Why Option A (decided):** zero navigation cost; user's mental model stays "I'm generating cards." Refresh risk is mitigated by the browser prompt.

### 2. [H] Page-level review framing (no per-card status)

**Approved: yes — no per-card status badge.**

The whole page implicitly is the review state until Submit, so we do not differentiate cards visually. The signal that "nothing is saved yet" comes from page structure, not per-card decoration:

- Section header above the list: **"Review N generated cards"** + helper text: *"Edit or discard any. Nothing is saved until you click Save."*
- Persistent Submit button below the list (and optionally sticky at the bottom of the viewport for long batches).
- No "Draft" / "Pending" / "NEW" badge on review-list cards.

The existing "NEW" highlight on `/decks/[id]` after a successful Submit (Image #6) is unaffected — that's a post-save affordance ("here is what you just added"), not a draft status, and remains useful.

### 3. [H] Bulk save mechanics

**Approved: yes.**

- Submit button label includes the live count and target deck name: **"Save 8 cards to <deck name>"**. Decrement as cards are discarded.
- Submit is the only path that writes to the database. Single endpoint call: `POST /api/cards/bulk` with the full batch.
- Transaction semantic: all-or-nothing. On partial failure, no cards land in the deck and the user sees an error toast; the review list stays on screen so they can retry.
- Disable submit when 0 cards remain; show inline message "No cards to save — paste again or edit text."

### 4. [M] Inline edit for review-list cards

**Approved: yes.**

Use the project's existing inline-edit pattern (per `feedback_inline_edit_error.md`): clicking Edit swaps FRONT / BACK to editable text inputs in place, with Save / Cancel inline. Since cards are not yet persisted, "Save" only commits the edit to in-memory batch state — no API call. Keep the row in edit mode on validation error so typed input is not lost.

### 5. [M] Terminology consistency

**Approved: pending**

Pick one of "cards" or "flashcards" across the page and the rest of the app. Recommendation: **"cards"** (shorter, already used in the product name and most copy). Updates:

- Button: "Generate cards" → "Generate cards" (already aligned with title).
- Textarea placeholder: "Paste text to generate cards…".
- Success banner: "8 new cards added" — already correct.

### 6. [L] Generate form polish

**Approved: pending**

- Counter: `"0 / 6000 characters"`.
- Textarea: `min-height` ~12 rem; auto-grow up to ~50 vh.
- Disabled Generate button: lower opacity + `cursor-not-allowed` + tooltip "Paste some text to generate cards".

### 7. [H] Two-phase loading states

**Approved: yes.**

The new flow splits one user-perceived "wait" into two:

- **Phase 1 — Generate (LLM call, no DB write):** Generate button shows spinner + label changes to "Generating…". Disable form controls. Show skeleton placeholders in the review-list area for the expected card count. Acknowledgement must appear within NFR-1's 2 s budget.
- **Phase 2 — Submit (DB bulk write):** Submit button shows spinner + label changes to "Saving…". Disable per-card Edit / Discard during the save. On success: redirect to `/decks/[id]`. On failure: re-enable controls, toast the error, keep the review list intact.

The Generate button must NOT show a "Saved" state — clicking Generate no longer writes anything. Only Submit does.

## Missing states / edge cases

- **Zero cards returned from generation** → empty state in the review-list area: "The AI didn't find anything worth turning into a card. Try pasting a different block of text."
- **Generation error** → toast with the user-readable error; paste preserved; no review list shown.
- **Refresh / navigate away with unsaved cards** → native `beforeunload` prompt (browser default). No custom modal, no `localStorage` persistence.
- **Save partial failure** → toast; review list remains on screen; user can retry; nothing partially written (all-or-nothing transaction).
- **User clicks Generate again while a review list exists** → confirm dialog: "Replace N unsaved cards with a new batch?"
- **User signs out with unsaved cards** → covered by `beforeunload` (sign-out triggers navigation).

## Implementation notes

- Files touched:
  - `src/pages/api/cards/generate.ts` — **remove the DB insert** (current lines 57–68). Endpoint becomes LLM-only; response shape changes from `{ ok, cards: <inserted rows> }` to `{ ok, cards: [{front, back}, …] }`. Keep the auth check and the deck-ownership SELECT guard (lines 40–48) — the bulk endpoint will need the same guard so it's a good shared shape.
  - New `src/pages/api/cards/bulk.ts` — `POST /api/cards/bulk` for transactional bulk insert. Body: `{ deck_id, cards: [{front, back}, …] }`. Returns the inserted rows + `deck_id` for the client-side redirect. Mirror the deck-ownership SELECT guard from `generate.ts` (same scanner-confirmation risk).
  - `src/components/cards/PasteToGenerate.tsx` — stop redirecting after Generate. Hold the returned batch in React state. Render the inline review list with Edit (inline) + Discard (in-memory remove) per row, and a Submit button at the bottom. Set up a `beforeunload` listener while the batch is non-empty; tear it down on Submit success or Discard-all.
  - `src/pages/generate.astro` — no structural change; `PasteToGenerate` already loaded as a `client:load` island.
- Existing per-card `+ Add card` and Edit / Delete paths (`src/pages/api/cards/[id].ts`, `src/pages/api/decks/[id]/cards.ts`) stay untouched.
- Keep NFR-1 (2 s acknowledgement, progress for full duration) and NFR-2 (no operator-accessible trace of pasted text) intact. The new flow does not change either property — in fact NFR-2 is *easier* to honor because pasted text never reaches a persisted-text path, and the LLM-derived card pairs only land in the DB after explicit Submit.
- The card row component on the review list and the card row on `/decks/[id]` will diverge: review-list rows use **Discard** (in-memory remove, no API call) and saved rows use **Delete** (DELETE API call). Do not over-share the component — a thin wrapper or two siblings is cleaner than a `variant` prop with diverging behavior.
