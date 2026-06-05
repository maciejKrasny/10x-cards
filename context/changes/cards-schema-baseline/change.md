---
change_id: cards-schema-baseline
title: Cards table + Supabase migration and codegen baseline
status: implementing
created: 2026-06-05
updated: 2026-06-05
archived_at: null
---

## Notes

Seeded from F-01 in `context/foundation/roadmap.md`.

Outcome (per roadmap): Supabase migrations and typed-client codegen pipeline are in place; a `cards` table exists with a Row-Level Security policy isolating each card to its owning user; downstream slices (S-01, S-02, S-03) can extend the schema by following the established migration + codegen pattern.

PRD refs: Access Control (per-user data scoping), Guardrails-1 (pasted text and generated cards never visible to other users).

Risk to keep in mind during planning: misconfigured RLS could leak one user's deck into another's view — the slice's exit gate is an explicit RLS policy plus a two-user smoke test.
