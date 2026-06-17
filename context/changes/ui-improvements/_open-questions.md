# Open questions

Questions raised during the review that need user input before they can be turned into recommendations.

| # | Screen | Question | Status |
|---|--------|----------|--------|
| 1 | `/generate`, `/decks/*` | Are named decks now in scope? | **resolved 2026-06-17** — yes, deck management is implemented; the "Target deck" selector stays. |
| 2 | `/generate` (review) | Review screen location: A inline / B dedicated route / C server-persisted? | **resolved 2026-06-17** — Option A (inline on `/generate`). |
| 3 | `/generate` (review) | Persist unsaved batch to `localStorage` and restore on refresh, or accept loss? | **resolved 2026-06-17** — accept loss; use native browser `beforeunload` prompt. No `localStorage`. |
| 4 | `/generate` (review) | Name for the unsaved state badge ("Draft", "Pending", "Not saved")? | **resolved 2026-06-17** — no per-card status badge. The whole page implicitly is the review state until Submit. |
| 5 | `/generate` | Does the Generate button already show a loading state during the 2 s acknowledgement window? | **resolved 2026-06-17** — adjust loading phases: Generate = "Generating…" (LLM only, no DB write); Submit = "Saving…" (DB bulk write). Two distinct phases. |
