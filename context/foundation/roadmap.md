---
project: 10xCards
version: 1
status: draft
created: 2026-05-28
updated: 2026-06-05
prd_version: 1
main_goal: speed
top_blocker: capacity
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

10xCards lets a professional learner paste a block of text and get a ready-to-study deck — no import workflow, no setup. The product wedge — the one trait that, if removed, makes 10xCards indistinguishable from existing flashcard tools — is copy-paste-first AI generation. The MVP closes the full spaced-repetition learning loop end-to-end in a single session, then brings the user back the next day.

## North star

**S-03: First spaced-repetition session** — closes the learning loop end-to-end (Primary Success Criterion). Every other slice exists either as a prerequisite for this slice or as a required fallback path for the wedge that feeds it.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as Prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID                       | Outcome (user can …)                                                            | Prerequisites | PRD refs                               | Status   |
| ---- | ------------------------------- | ------------------------------------------------------------------------------- | ------------- | -------------------------------------- | -------- |
| F-01 | cards-schema-baseline           | (foundation) cards table + RLS + migration & codegen pattern established        | —             | Access Control, Guardrails-1           | done     |
| S-01 | ai-generate-from-paste          | paste a block of text and get AI-generated cards auto-saved to their deck       | F-01          | US-01, FR-004, NFR-1, NFR-2            | proposed |
| S-02 | deck-management                 | list, edit, delete, and manually create cards                                   | F-01          | FR-005, FR-006, FR-007, FR-008         | proposed |
| S-03 | first-spaced-repetition-session | study their deck via a spaced-repetition session that persists review progress  | F-01, S-01    | US-01, FR-009, Primary SC, Guardrails-2 | proposed |
| S-04 | auth-prd-compliance             | sign up, confirm email, sign in, sign out — PRD-compliant journey with user-readable error states | —             | FR-001, FR-002, FR-003, Access Control | ready    |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks under `top_blocker: capacity`.

| Stream | Theme              | Chain                    | Note                                                                                                                                                                                                                          |
| ------ | ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Wedge → north star | `F-01` → `S-01` → `S-03` | Must-have path under `main_goal: speed`; surfaces AI-gen risk (CPU / subrequest cap) in week 1 and ends on the north star (Primary SC).                                                                                       |
| B      | Deck management    | `S-02`                   | Depends on `F-01` from Stream A. Runs in parallel with `S-01` once `F-01` is `done` — the biggest capacity-utilization lever in this roadmap. Joins Stream A back at `S-03` as the deck-list entry point into the SR session. |
| C      | Auth compliance    | `S-04`                   | No foundation prerequisite — fully orthogonal to the data/AI/SR path. Use as evening filler when Streams A/B work doesn't fit the available window; closes PRD §Access Control + FR-001/2/3 coverage strictly.                |

## Baseline

What's already in place in the codebase as of `2026-05-28` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19; auth UI pages (`signin`, `signup`, `confirm-email`) and `dashboard.astro` exist (`src/pages/`).
- **Backend / API:** partial — only auth API routes (`src/pages/api/auth/{signin,signup,signout}.ts`); no generation/cards/study routes.
- **Data:** absent — Supabase client wired (`src/lib/supabase.ts`) but no migrations, no schema, no domain tables, no generated types, no seed data.
- **Auth:** partial — Supabase Auth wired end-to-end (signin/signup/signout + `src/middleware.ts` + `PROTECTED_ROUTES = ["/dashboard"]` + email confirmation); this satisfies **FR-001** (register), **FR-002** (login), and **FR-003** (logout) without a roadmap slice. Password reset / forgot-password absent (not in PRD must-haves).
- **Deploy / infra:** present — Cloudflare Workers deploy live (`10x-cards.maciej-krasny97.workers.dev`); `wrangler.jsonc` configured with `nodejs_compat`; GitHub Actions CI (lint + build); Husky + lint-staged pre-commit hooks. Test runner absent.
- **Observability:** partial — `wrangler.jsonc` has `observability.enabled: true`; no Sentry, no structured logging, no metrics/tracing.

## Foundations

### F-01: Cards table + Supabase migration/codegen pattern

- **Outcome:** (foundation) Supabase migrations and typed-client codegen pipeline are in place; a `cards` table exists with a Row-Level Security policy isolating each card to its owning user; downstream slices can extend the schema by following the established migration + codegen pattern.
- **Change ID:** cards-schema-baseline
- **PRD refs:** Access Control (per-user data scoping), Guardrails-1 (pasted text and generated cards never visible to other users)
- **Unlocks:** S-01 (writes cards post-AI-gen), S-02 (reads/edits/deletes cards), S-03 (extends schema with `reviews` table by following the same pattern; reads cards)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because every user-facing slice needs the `cards` table; under `top_blocker: capacity`, F-01 unlocks `S-01 ∥ S-02` parallel work, which is the single biggest lever for fitting the MVP into evening-only capacity. Failure mode: misconfigured RLS leaks one user's deck into another's view, violating Guardrails-1 — mitigation is to write the RLS policy explicitly in this slice and verify with a two-user smoke test before declaring `done`.
- **Status:** done

## Slices

### S-01: Paste text → AI-generated cards saved to the deck

- **Outcome:** A logged-in user pastes a block of text, triggers AI generation, and finds the generated cards already saved to their deck — visible in a minimal post-generation view, with acknowledgement appearing within 2 s of triggering and visible progress for the full duration of the operation.
- **Change ID:** ai-generate-from-paste
- **PRD refs:** US-01 (generation path + auto-save), FR-004 (must-have), NFR-1 (2 s acknowledgement + visible progress), NFR-2 (pasted text leaves no operator-accessible trace after the request completes)
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:**
  - Which LLM model + provider config (model name, max tokens, temperature, monthly cost ceiling)? — Owner: user. Block: no (resolvable in `/10x-plan`).
  - How is "pasted text leaves no operator-accessible trace" verified — no log line, no analytics event, no Supabase row capturing the raw text? — Owner: implementer. Block: no.
  - Hard cap on number of generated cards per paste, to stay within Cloudflare Workers' subrequest cap and CPU-time budget? — Owner: implementer. Block: no.
- **Risk:** Wedge of the product AND the highest-technical-risk slice in the must-have set. `infrastructure.md` risk register flags CPU-time exhaustion and subrequest-cap breach on long pastes as Medium-likelihood / High-impact. Under `main_goal: speed`, sequencing the wedge as `S-01` surfaces this risk in week 1 rather than week 3 — if AI-gen quality or platform economics fail, every downstream slice's value collapses. Failure mode: long pastes time out silently or produce low-quality cards that the user deletes en-masse, eroding the wedge.
- **Status:** proposed

### S-02: Deck management — list, edit, delete, and manually create cards

- **Outcome:** A logged-in user views every card in their deck, edits the front/back of any card, deletes any card, and adds a new card manually (the gen-failure fallback path that US-01's acceptance criteria require).
- **Change ID:** deck-management
- **PRD refs:** FR-005 (manual create — also the gen-fail fallback), FR-006 (edit), FR-007 (delete), FR-008 (organize / list)
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Inline-edit-in-list versus a separate edit screen? — Owner: implementer. Block: no.
  - Delete confirmation gate, undo affordance, or hard delete? — Owner: implementer. Block: no.
- **Risk:** Required for US-01 acceptance ("user can edit or delete any card in the batch after generation" + "if AI generation fails, the user can still add cards manually"). Parallel-with `S-01` maximizes capacity utilization under `top_blocker: capacity`. Failure mode: scope creep into "deck organization" features (tagging, search, bulk actions) that are not in the must-have FRs and should stay in `## Parked`.
- **Status:** proposed

### S-03: First spaced-repetition session (north star)

- **Outcome:** A logged-in user with cards in their deck starts a spaced-repetition session, sees one card at a time, rates recall, and finishes the session — their progress (review history per card) is persisted and the next-due scheduling has been computed by an existing open-source SR library (e.g. ts-fsrs). When they return the next day, the deck shows cards due for review.
- **Change ID:** first-spaced-repetition-session
- **PRD refs:** US-01 (the "study" arm of the journey), FR-009 (must-have, wrap existing SR library), Primary Success Criterion (full learning loop closes end-to-end), Guardrails-2 ("SR review session must never lose progress or show the wrong card"), Non-Goal-1 (no custom SR algorithm)
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02 (S-02 supplies a logical entry point into the session via the deck list, but this slice can ship with a dashboard-level "Start session" entry if S-02 is not yet `done`)
- **Blockers:** —
- **Unknowns:**
  - Which SR library version (ts-fsrs vs alternative) and which scheduling parameters (default deck settings, due-date tolerance)? — Owner: implementer. Block: no (resolvable in `/10x-plan`).
  - Reviews-table schema shape — does it store the full FSRS state (stability, difficulty, retrievability) or only a minimal review-event log? The shape choice affects whether the SR library can be swapped later. — Owner: implementer. Block: no.
  - Session UX boundary — what counts as "session complete" (every due card reviewed, fixed batch size, time-bounded)? — Owner: implementer. Block: no.
- **Risk:** North star — this slice IS the validation milestone the Primary Success Criterion names. Sequenced as early as Prerequisites allow under `main_goal: speed`. Failure mode for the slice: review state is lost between sessions (Guardrails-2 violation), or the next-due scheduling diverges from the wrapped library's contract; mitigation is to wrap ts-fsrs (or equivalent) rather than reimplement (Non-Goal-1 already enforces this) and to use an idempotent persist-then-acknowledge pattern in the review-write endpoint.
- **Status:** proposed

### S-04: Auth flow PRD compliance

- **Outcome:** A new visitor completes the full PRD-compliant journey (sign-up → email confirmation → sign-in → `/dashboard` → sign-out) with user-readable error states at each failure point; the protected routes registered by S-01 / S-02 / S-03 are added to `PROTECTED_ROUTES` so unauthenticated requests are redirected to `/auth/signin` per PRD §Access Control.
- **Change ID:** auth-prd-compliance
- **PRD refs:** FR-001 (register), FR-002 (login), FR-003 (logout), Access Control (redirect-on-unauth)
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02
- **Blockers:** —
- **Unknowns:**
  - Is Supabase email confirmation required in this project's Auth settings, or is sign-in available immediately post-sign-up? — Owner: implementer. Block: no.
- **Risk:** Low — no new infrastructure, no new external dependencies, baseline scaffolding already in place. Failure mode: scope creep into password-reset / OAuth / account-deletion flows that aren't in PRD must-haves (those stay in `## Parked` for v1.5). Why sequenced here: closes PRD coverage strictly (FR-001/2/3 → slice, not baseline) AND under `top_blocker: capacity` provides a small ready slice that can be picked up when a longer Stream A/B session isn't feasible.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID                       | Suggested issue title                                                  | Ready for `/10x-plan` | Notes                                              |
| ---------- | ------------------------------- | ---------------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| F-01       | cards-schema-baseline           | Cards table + Supabase migration / codegen baseline (with RLS)         | yes                   | Run `/10x-plan cards-schema-baseline` first.       |
| S-01       | ai-generate-from-paste          | Paste text → AI generates and saves flashcards (wedge)                 | no                    | Becomes `ready` once F-01 lands.                   |
| S-02       | deck-management                 | List, edit, delete, and manually create flashcards                     | no                    | Becomes `ready` once F-01 lands; parallel with S-01. |
| S-03       | first-spaced-repetition-session | First spaced-repetition session — close the learning loop (north star) | no                    | Becomes `ready` once F-01 and S-01 are `done`.     |
| S-04       | auth-prd-compliance             | Auth journey: PRD compliance + clean error states                      | yes                   | Standalone — no Prereqs; runs in parallel with any other slice. |

## Open Roadmap Questions

1. **Should the original 75% AI card acceptance rate and 75% AI creation rate be formalized as measurable Success Criteria?** — Owner: user. Block: roadmap-wide non-blocking; resolving this strengthens `S-01`'s verification path (a measurable bar for "is AI-gen quality good enough?" rather than a qualitative read).

## Parked

- **FR-010: Named decks for organizing flashcards by topic** — PRD demoted to nice-to-have; single-deck-per-user for MVP is sufficient. Revisit in v2.
- **Custom spaced-repetition algorithm** — PRD Non-Goal-1; MVP wraps an existing library.
- **Multi-format import (PDF, DOCX, images, URL scraping)** — PRD Non-Goal-2.
- **Deck sharing between users / public deck libraries / cross-account export-import** — PRD Non-Goal-3.
- **Native mobile apps (iOS, Android)** — PRD Non-Goal-4.
- **Password-reset / forgot-password flow** — absent from baseline; not in PRD must-haves. Park for v1.5 unless a real user is locked out.
- **Sentry / structured logging / metrics / tracing** — Cloudflare Workers `observability.enabled` is sufficient for MVP debugging via `wrangler tail`. Promote out of `## Parked` only if S-01's CPU/subrequest-cap risk materializes in production.
- **Automated test runner (vitest + Playwright)** — under `main_goal: speed` + `top_blocker: capacity`, parked for MVP. CI currently runs lint + build. Smoke-test by hand before deploy; promote out of `## Parked` after the first user-reported regression.

## Done

(Empty on first generation. `/10x-archive` appends an entry here when a change whose `Change ID` matches a roadmap item is archived.)

- **F-01: (foundation) Supabase migrations and typed-client codegen pipeline are in place; a `cards` table exists with a Row-Level Security policy isolating each card to its owning user; downstream slices can extend the schema by following the established migration + codegen pattern.** — Archived 2026-06-05 → `context/archive/2026-06-05-cards-schema-baseline/`. Lesson: —.
