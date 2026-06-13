/clr---
source: Context7 MCP
libraries:
  - /open-spaced-repetition/ts-fsrs (source repo)
  - /websites/open-spaced-repetition_github_io_ts-fsrs (API reference site)
fetched: 2026-06-13
purpose: Implementation reference for S-03 (first-spaced-repetition-session). Resolves the "reviews-table schema shape" unknown in roadmap.md.
---

# ts-fsrs API docs — slice S-03

Curated reference fetched via Context7 MCP. Covers exactly the surface needed to ship S-03: schedule a card, rate recall, persist state, query due cards.

## Core API surface

```typescript
import { createEmptyCard, fsrs, Rating, type FSRSParameters } from 'ts-fsrs'

const scheduler = fsrs()              // optional FSRSParameters arg
const card = createEmptyCard()        // for a brand-new card

// Preview all 4 outcomes (Again/Hard/Good/Easy) without committing:
const preview = scheduler.repeat(card, new Date())
preview[Rating.Good].card             // what the card would become after Good

// Commit the user's rating; returns updated card + log entry:
const { card: nextCard, log } = scheduler.next(card, new Date(), Rating.Good)
```

- `Rating` enum: `Again | Hard | Good | Easy`
- `State` enum: `New | Learning | Review | Relearning`

## Card state to persist (schema decision)

ts-fsrs needs the **full Card state** on each `next()` / `repeat()` call — a minimal event-log alone is insufficient because the algorithm is stateful. Mirror this on the `cards` row (or a 1:1 `card_state` table):

```typescript
interface Card {
  difficulty: number
  due: Date
  elapsed_days: number
  lapses: number
  last_review?: Date
  learning_steps: number
  reps: number
  scheduled_days: number
  stability: number
  state: State
}
```

`CardInput` accepts `DateInput` (string | number | Date), so ISO-string round-trip from Postgres works without manual coercion.

## ReviewLog (append-only audit table)

```typescript
interface ReviewLog {
  difficulty: number
  due: Date
  learning_steps: number
  rating: Rating
  review: Date
  scheduled_days: number
  stability: number
  state: State
  // elapsed_days, last_elapsed_days — DEPRECATED, removed in 6.0.0; don't depend on them.
}
```

Sample JSON (`State` and `Rating` serialize as integers):

```json
{
  "difficulty": 5,
  "due": "2023-10-27T10:00:00.000Z",
  "learning_steps": 0,
  "rating": 3,
  "review": "2023-10-26T10:00:00.000Z",
  "scheduled_days": 7,
  "stability": 2.5,
  "state": 1
}
```

## Configuration

```typescript
const params: FSRSParameters = { request_retention: 0.9, maximum_interval: 36500 }
const scheduler = fsrs(params)
```

- Defaults are fine for MVP.
- Params serialize cleanly as JSON if per-user tuning is ever exposed:

```typescript
const serialized = '{"request_retention":0.9,"maximum_interval":36500}'
const parsed = JSON.parse(serialized) as FSRSParameters
const scheduler = fsrs(parsed)
```

Runtime-validate before passing external input through (zod or equivalent).

## Due-cards query

Standard SQL — no library helper needed:

```sql
WHERE due <= now()
```

Index `cards(user_id, due)` for the SR-session entry point.

## S-03 implications (maps to roadmap.md unknowns)

- **"Reviews-table schema shape — full FSRS state or minimal event log?"** → Store full Card state (10 fields) on the row that backs `card`. Append a `review_logs` table for history/analytics. Storing only events makes the next `next()` call impossible.
- **"Library swap later"** → ReviewLog is the portable record (rating + timestamp sequence). Card state is FSRS-specific but can be re-derived from logs under a different algorithm. Don't fight the coupling for MVP.
- **Guardrails-2 ("never lose progress or show the wrong card")** → `scheduler.next()` is pure given `(card, now, rating)`; persist-then-acknowledge with a unique key on `(card_id, review_timestamp)` makes the review-write endpoint idempotent.
- **Non-Goal-1 (no custom SR algorithm)** → use `scheduler.next()` output verbatim; never recompute `stability` / `difficulty` by hand.

## Sources

- README: https://github.com/open-spaced-repetition/ts-fsrs/blob/main/README.md
- API reference: https://open-spaced-repetition.github.io/ts-fsrs/
- `Card`: https://open-spaced-repetition.github.io/ts-fsrs/interfaces/Card
- `ReviewLog`: https://open-spaced-repetition.github.io/ts-fsrs/interfaces/ReviewLog
- `CardInput` / `ReviewLogInput`: https://open-spaced-repetition.github.io/ts-fsrs/interfaces/CardInput
