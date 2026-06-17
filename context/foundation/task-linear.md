---
project: 10xCards
version: 1
created: 2026-05-30
---

# Task Management: Linear Mirror

> Linear is a secondary mirror of the GitHub Issues roadmap structure.
> This file documents the workspace setup, label system, status mapping, issue IDs, and conventions for keeping Linear in sync with `roadmap.md` and `task-management.md`.

## Workspace

- **Workspace**: `10x-cards-mk`
- **Team key prefix**: `10X`
- **Project**: [10xCards MVP](https://linear.app/10x-cards-mk/project/10xcards-mvp-9f558739e594)

## Label system

Labels mirror the GitHub label system exactly. The `status:` labels are intentionally absent — Linear's native workflow states handle that (see Status mapping below).

### Type

| Label              | Color     | Meaning                                                                            |
| ------------------ | --------- | ---------------------------------------------------------------------------------- |
| `type: foundation` | `#0075ca` | Horizontal enabler — no user-visible outcome on its own; unlocks downstream slices |
| `type: slice`      | `#e4e669` | Vertical, user-visible milestone                                                   |

### Stream (one-word outcome of the stream)

| Label                | Color     | Stream                                       | Roadmap items    |
| -------------------- | --------- | -------------------------------------------- | ---------------- |
| `stream: learning`   | `#d93f0b` | AI generation → spaced repetition north star | F-01, S-01, S-03 |
| `stream: management` | `#0e8a16` | Deck management                              | S-02             |
| `stream: auth`       | `#5319e7` | Auth PRD compliance                          | S-04             |

## Status mapping

GitHub labels are translated to Linear's native workflow states so Linear filtering works without custom status labels.

| GitHub label       | Linear state | Rationale                                      |
| ------------------ | ------------ | ---------------------------------------------- |
| `status: ready`    | **Todo**     | Actionable now — appears in the active backlog |
| `status: proposed` | **Backlog**  | Blocked by prerequisites — not yet actionable  |

## Roadmap → Linear issues mapping

| Roadmap ID | Change ID                         | Linear ID                                            | Linear State | GitHub mirror                                               |
| ---------- | --------------------------------- | ---------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| F-01       | `cards-schema-baseline`           | [10X-5](https://linear.app/10x-cards-mk/issue/10X-5) | Todo         | [GH #1](https://github.com/maciejKrasny/10x-cards/issues/1) |
| S-04       | `auth-prd-compliance`             | [10X-6](https://linear.app/10x-cards-mk/issue/10X-6) | Todo         | [GH #2](https://github.com/maciejKrasny/10x-cards/issues/2) |
| S-01       | `ai-generate-from-paste`          | [10X-7](https://linear.app/10x-cards-mk/issue/10X-7) | Backlog      | [GH #3](https://github.com/maciejKrasny/10x-cards/issues/3) |
| S-02       | `deck-management`                 | [10X-8](https://linear.app/10x-cards-mk/issue/10X-8) | Backlog      | [GH #4](https://github.com/maciejKrasny/10x-cards/issues/4) |
| S-03       | `first-spaced-repetition-session` | [10X-9](https://linear.app/10x-cards-mk/issue/10X-9) | Done         | [GH #5](https://github.com/maciejKrasny/10x-cards/issues/5) |

## Dependency graph

```
10X-5 F-01 (Todo)
├── 10X-7 S-01 (Backlog) ──┐
│                           ├── 10X-9 S-03 (Done)  ← north star
└── 10X-8 S-02 (Backlog) ──┘

10X-6 S-04 (Todo)  ← standalone, no prereqs
```

`blockedBy` relations are wired natively in Linear — 10X-7, 10X-8, and 10X-9 each show their blockers in the issue detail view.

## Sync conventions

- When a prerequisite issue is moved to **Done**, manually move its Linear dependents from **Backlog** → **Todo** and flip the matching GitHub label from `status: proposed` → `status: ready`.
- When `/10x-new <change-id>` creates an implementation folder, add a comment on the Linear issue linking `context/changes/<change-id>/`.
- When a change is archived via `/10x-archive`, mark the Linear issue **Done** and close the corresponding GitHub issue.
- Do **not** create Linear issues without a matching roadmap entry — add to `roadmap.md` first, then mirror to both GitHub and Linear.
- Each Linear issue carries a link attachment pointing to its GitHub counterpart (set at creation time).
