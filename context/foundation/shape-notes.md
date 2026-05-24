---
project: "10xCards"
context_type: greenfield
created: 2026-05-18
updated: 2026-05-18
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 9
  gray_areas_resolved:
    - topic: "insight / competitive differentiation"
      decision: "copy-paste-first UX — no import/export workflow; zero setup"
    - topic: "primary persona"
      decision: "professional learner — certifications, onboarding, work-related material"
    - topic: "pain category"
      decision: "workflow friction — the task is possible but too slow, so users skip it"
    - topic: "auth model"
      decision: "email + password or OAuth; multi-user; decks persisted to account"
    - topic: "role model"
      decision: "flat — all users have identical capabilities"
    - topic: "deck model"
      decision: "single deck per user for MVP; named multi-deck deferred to v2"
    - topic: "AI card review UX"
      decision: "auto-save all generated cards; user deletes unwanted after generation"
    - topic: "SR algorithm"
      decision: "wrap existing open-source SM-2 library (e.g. ts-fsrs); do not build from scratch"
  quality_check_status: accepted
---

## Vision & Problem Statement

Manual creation of high-quality flashcards for spaced repetition is time-consuming, so professional learners preparing for certifications, onboarding to new roles, or absorbing domain-specific material skip the deck-building step entirely — and the effective learning method never happens.

The insight: existing tools (Anki, Quizlet, Remnote) require import/export workflows, plugin ecosystems, or dedicated file formats. 10xCards is copy-paste-first — paste a block of text, get a deck. Zero setup, instant generation. The friction removed is not the spaced repetition itself, but the entry cost before it can start.

## User & Persona

**Primary persona: Professional learner**
A professional preparing for a certification exam, going through onboarding documentation at a new job, or studying domain-specific material required for their work. They have a block of text — a doc, a course chapter, a spec — and need to turn it into something they can actually retain. They know spaced repetition works; they don't have time to build the deck.

## Functional Requirements

### Authentication

- FR-001: User can register a new account with email/password. Priority: must-have

  > Socrates: Counter-argument considered: "ship anonymous-first, add auth later." Resolution: kept as must-have — spaced repetition requires persistent review history across sessions; auth cannot be deferred.

- FR-002: User can log in to their account. Priority: must-have

  > Socrates: No counter-argument raised; load-bearing alongside FR-001.

- FR-003: User can log out of their account. Priority: must-have
  > Socrates: No counter-argument raised; standard complement to FR-002.

### Card Generation & Management

- FR-004: User can paste text and receive AI-generated flashcards, all auto-saved to their deck. Priority: must-have

  > Socrates: Counter-argument considered: "quality will be low without domain fine-tuning." Resolution: kept as must-have — the 75% acceptance-rate success criterion is the quality gate; generic LLM is the v1 bet; fine-tuning deferred.

- FR-005: User can create a flashcard manually. Priority: must-have

  > Socrates: Counter-argument considered: "edit-rejected AI cards instead of a blank form." Resolution: kept — AI auto-saves all cards; users need a way to add cards the model missed entirely, not just fix bad ones.

- FR-006: User can edit a saved flashcard. Priority: must-have

  > Socrates: No counter-argument raised; required to fix AI output after auto-save.

- FR-007: User can delete a flashcard. Priority: must-have
  > Socrates: Counter-argument accepted: "per-card review gate before saving → auto-save all, delete unwanted." FR-007 replaces the pre-save review step. The review step (FR-007 in original) was changed to bulk delete after generation — simpler UX, same end-state.

### Study

- FR-008: User can study their deck using a SM-2-based spaced repetition algorithm. Priority: must-have
  > Socrates: Counter-argument clarified: "use an existing open-source SR library rather than implementing SM-2." Confirmed — wrap an existing library (e.g. ts-fsrs); do not build the algorithm from scratch.

### Nice-to-have (deferred from MVP)

- FR-009: User can create named decks to organize flashcards by topic. Priority: nice-to-have
  > Socrates: Counter-argument accepted: "one deck per user is enough for MVP." FR-009 demoted to nice-to-have. Single deck per user for v1; named decks in v2.

## User Stories

### US-01: User generates flashcards from pasted text

- **Given** a logged-in user
- **When** they paste a block of text and trigger AI generation
- **Then** all generated flashcards are automatically saved to their deck, and they can review the batch — editing or deleting individual cards as needed

#### Acceptance Criteria

- Each generated card shows a front (question) and back (answer)
- All generated cards are saved immediately; no per-card confirmation gate
- User can edit or delete any card in the batch after generation
- If AI generation fails, the user sees an error message and can still add cards manually

---

## Business Logic

10xCards decides which parts of a text are worth memorizing and how to best transform them into question–answer flashcards for spaced repetition learning.

The rule consumes a single user-facing input: a block of raw text pasted into the product. From that text, it identifies concepts, facts, and relationships that carry learning value, then encodes each as a front/back flashcard pair optimized for recall under a spaced repetition schedule. The user encounters the output as a batch of cards added to their deck — they can edit or delete any card, but the selection and transformation are done by the product, not by the user.

## Non-Functional Requirements

- A user sees continuous visible progress during AI generation; acknowledgement appears within 2 seconds of triggering generation, and progress is visible for the full duration of any operation that takes longer.
- Pasted text submitted for AI processing leaves no trace in operator-accessible storage after the generation request that consumed it completes.
- The product remains fully usable on the latest two major versions of Chrome, Firefox, Safari, and Edge on desktop.

---

## Success Criteria

### Primary

- A user signs up, pastes a block of text, reviews the AI-generated cards, and completes at least one spaced repetition study session — the full learning loop closes end-to-end.

### Secondary

- The user returns the next day (or next scheduled interval) to study a second session — the product is sticky enough to bring them back.

### Guardrails

- Pasted text and generated cards are never visible to other users or accessible to third parties. User data is scoped strictly to the authenticated account.

---

## Access Control

Multi-user web application. Users authenticate with email + password or OAuth (provider TBD). Each user's decks and review history are scoped to their account. Flat user model — all accounts have identical capabilities. No admin or guest roles in MVP. An unauthenticated user visiting a gated route is redirected to the login screen.

## Non-Goals

- **No custom spaced repetition algorithm** — wrap an existing open-source SM-2 implementation (e.g. ts-fsrs). Building a custom scheduler (SuperMemo, FSRS from scratch) is out of scope for v1.
- **No multi-format import** — source material enters only via copy-paste text. PDF, DOCX, images, and URL scraping are not in scope for MVP.
- **No deck sharing between users** — decks are private to the authenticated account. Collaborative decks, public deck libraries, and deck export/import between users are not in scope for v1.
- **No mobile apps** — web only for v1. Native iOS and Android applications are explicitly out of scope.
