---
change_id: first-spaced-repetition-session
title: First spaced-repetition session (north star)
status: archived
created: 2026-06-13
updated: 2026-06-17
archived_at: 2026-06-17T17:49:00Z
---

## Notes

Roadmap slice **S-03 — first-spaced-repetition-session** (north star). See `context/foundation/roadmap.md` §S-03.

- **Outcome:** Logged-in user with cards starts an SR session, sees one card at a time, rates recall, finishes the session; review history persists per card; next-due scheduling is computed by an existing OSS SR library (e.g. `ts-fsrs`). Returning the next day, the deck shows cards due for review.
- **PRD refs:** US-01 (study arm), FR-009 (wrap existing SR library), Primary Success Criterion (full learning loop closes end-to-end), Guardrails-2 (SR session must never lose progress or show the wrong card), Non-Goal-1 (no custom SR algorithm).
- **Prerequisites (both `done`):** F-01 (`cards-schema-baseline`), S-01 (`ai-generate-from-paste`).
- **Parallel-with:** S-02 (`deck-management`, now `done` — supplies deck-list entry point; dashboard-level "Start session" is an acceptable fallback).
- **GitHub issue:** [#5](https://github.com/maciejKrasny/10x-cards/issues/5) (mirror in `context/foundation/task-management.md`). Include `Refs: #5` in commits; close on archive.
