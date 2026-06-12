---
change_id: deck-management
title: Deck management — list, edit, delete, and manually create cards
status: implementing
created: 2026-06-12
updated: 2026-06-12
archived_at: null
---

## Notes

Roadmap slice **S-02** (`deck-management`) from `context/foundation/roadmap.md`.

**Outcome:** A logged-in user views every card in their deck, edits the front/back of any card, deletes any card, and adds a new card manually (the gen-failure fallback path that US-01's acceptance criteria require).

**PRD refs:** FR-005 (manual create — also the gen-fail fallback), FR-006 (edit), FR-007 (delete), FR-008 (organize / list).

**Prerequisites:** F-01 (done). **Parallel with:** S-01 (done).

**Open unknowns to resolve in `/10x-plan`:**
- Inline-edit-in-list versus a separate edit screen.
- Delete confirmation gate, undo affordance, or hard delete.

**Risk / guardrail:** Required for US-01 acceptance ("user can edit or delete any card in the batch after generation" + "if AI generation fails, the user can still add cards manually"). Watch for scope creep into deck organization features (tagging, search, bulk actions) — those are parked.
