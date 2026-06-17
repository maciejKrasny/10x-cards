---
project: 10xCards
version: 1
created: 2026-05-30
---

# Task Management: GitHub Issues Mirror

> GitHub Issues is the single source of truth for active work.
> This file documents the mapping from `roadmap.md` to issues, the label system, and the conventions for keeping the two in sync.

## Repository

`https://github.com/maciejKrasny/10x-cards`

## Label system

### Type

| Label              | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `type: foundation` | Horizontal enabler — no user-visible outcome on its own; unlocks downstream slices |
| `type: slice`      | Vertical, user-visible milestone                                                   |

### Stream (one-word outcome of the stream)

| Label                | Stream                                       | Roadmap items    |
| -------------------- | -------------------------------------------- | ---------------- |
| `stream: learning`   | AI generation → spaced repetition north star | F-01, S-01, S-03 |
| `stream: management` | Deck management                              | S-02             |
| `stream: auth`       | Auth PRD compliance                          | S-04             |

### Status

| Label              | Meaning                                          |
| ------------------ | ------------------------------------------------ |
| `status: ready`    | Prerequisites met — can be picked up immediately |
| `status: proposed` | Waiting on one or more prerequisites             |

## Roadmap → Issues mapping

| Roadmap ID | Change ID                         | GitHub Issue                                                                                                       | Status |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| F-01       | `cards-schema-baseline`           | [#1 Cards table + Supabase migration/codegen baseline](https://github.com/maciejKrasny/10x-cards/issues/1)         | done   |
| S-04       | `auth-prd-compliance`             | [#2 Auth journey: PRD compliance + clean error states](https://github.com/maciejKrasny/10x-cards/issues/2)         | ready  |
| S-01       | `ai-generate-from-paste`          | [#3 Paste text → AI generates and saves flashcards](https://github.com/maciejKrasny/10x-cards/issues/3)            | done   |
| S-02       | `deck-management`                 | [#4 List, edit, delete, and manually create flashcards](https://github.com/maciejKrasny/10x-cards/issues/4)        | done   |
| S-03       | `first-spaced-repetition-session` | [#5 First spaced-repetition session — close the learning loop](https://github.com/maciejKrasny/10x-cards/issues/5) | done   |

## Dependency graph

```
#1 F-01 (done)
├── #3 S-01 (done) ──┐
│                    ├── #5 S-03 (done)  ← north star
└── #4 S-02 (done) ──┘

#2 S-04 (ready)  ← standalone, no prereqs
```

## Sync conventions

- When a prerequisite issue is closed, manually flip its dependents from `status: proposed` → `status: ready` on GitHub.
- When `/10x-new <change-id>` creates an implementation folder, link the resulting `context/changes/<change-id>/` to the issue via a comment.
- When a change is archived via `/10x-archive`, close the corresponding GitHub issue.
- Do **not** create new issues directly on GitHub without a matching roadmap entry — add to `roadmap.md` first, then mirror here.
