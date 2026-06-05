---
change_id: ai-generate-from-paste
title: Paste text → AI-generated cards saved to the deck
status: implemented
created: 2026-06-05
updated: 2026-06-05
archived_at: null
---

## Notes

Source: `context/foundation/roadmap.md` → S-01 (`ai-generate-from-paste`).

- Prerequisites: F-01 (`cards-schema-baseline`) — done (archived 2026-06-05).
- Parallel with: S-02 (`deck-management`).
- PRD refs: US-01, FR-004, NFR-1 (2 s acknowledgement + visible progress), NFR-2 (no operator-accessible trace of pasted text).
- Wedge of the product + highest-technical-risk slice in the must-have set. Sequenced first under `main_goal: speed` to surface CPU-time / subrequest-cap risk in week 1.
- Open unknowns to resolve in `/10x-plan`:
  - LLM model + provider config (model name, max tokens, temperature, monthly cost ceiling) — owner: user.
  - Verification approach for "no operator-accessible trace" (no log line, no analytics event, no Supabase row capturing raw text).
  - Hard cap on generated cards per paste (Workers subrequest cap + CPU-time budget).
