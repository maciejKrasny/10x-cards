---
change_id: first-spaced-repetition-session
doc: library-research
created: 2026-06-13
sources: exa web_search (ts-fsrs, FSRS/SM-2 TS implementations, Cloudflare Workers compatibility)
---

# SR library research — S-03

Constraints from `context/foundation/tech-stack.md` and `AGENTS.md`:

- Astro 6 SSR on **Cloudflare Workers** (`nodejs_compat`); Node v22.14.0 pinned
- TypeScript end-to-end; React 19 for interactive UI
- Supabase Postgres for persistence
- PRD Non-Goal-1: must wrap an existing OSS library (no custom algorithm)
- Roadmap §S-03 names `ts-fsrs` as the example

## Recommendation: `ts-fsrs` (open-spaced-repetition/ts-fsrs)

- **Algorithm:** FSRS v5 — ~22% better log-loss than SM-2 on 20M-review Anki benchmark; FSRS-5 RMSE ~5.3% vs SM-2's ~16.2%
- **Latest:** v5.4.1 (May 2026); 81 releases; 664 stars; **58K weekly downloads**; MIT
- **Dependencies:** zero
- **Module formats:** ESM + CJS + UMD; pure TS, no WASM
- **Runtime:** Node ≥20 (satisfied — project on v22.14.0)
- **Edge fit:** docs state "Edge Runtimes: Compatible with WASM-free environments" — runs on Cloudflare Workers
- **Footprint:** ~1KB per FSRS instance; microseconds per card; stateless / thread-safe
- **API shape** (relevant for `## Unknowns` in roadmap §S-03):
  - `createEmptyCard()` → initial Card with stability/difficulty/state/due
  - `fsrs(params?)` → scheduler; `params` accepts `request_retention`, `maximum_interval`, `enable_fuzz`, `enable_short_term`, `learning_steps`, `relearning_steps`
  - `scheduler.repeat(card, now)` → preview all 4 outcomes (Again/Hard/Good/Easy)
  - `scheduler.next(card, now, rating)` → `{ card, log }` after rating is known
  - `Card` and `ReviewLog` are JSON-serializable — fit Supabase row storage directly

### Caveat — optimizer is NOT edge-compatible

`@open-spaced-repetition/binding` (the companion parameter-trainer, Rust via NAPI / WASI) **cannot run on Cloudflare Workers** — WASI is unsupported on edge runtimes. This is **not needed for S-03**: it only trains custom weights from review history. Default FSRS parameters are sufficient for MVP. If parameter optimization is ever wanted, it would run as a separate Node service.

### Why this resolves the S-03 unknowns

- "Which SR library version" → `ts-fsrs@^5.4` (latest stable major)
- "Reviews-table schema shape" → store full FSRS state per card (`stability`, `difficulty`, `due`, `state`, `last_review`) plus an append-only `review_logs` table; the library's serializable `Card` / `ReviewLog` shapes give a clean column mapping and keep future library swaps cheap
- "Default deck settings" → `request_retention: 0.9`, `maximum_interval: 36500`, `enable_fuzz: true` (library defaults — match Anki's recommended FSRS defaults)

## Alternates considered

| Package                        | Algo            | Status                                               | Why not first pick                                                                                              |
| ------------------------------ | --------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@squeakyrobot/fsrs`           | FSRS v4.5 (+v6) | 0 deps; explicit CF Workers example in README        | 7 weekly downloads — unproven; v0.x                                                                             |
| `quanta-fsrs`                  | FSRS v4.5/v5    | 0 deps; edge-ready; in production at quanta-study.de | Single contributor; recent (Apr 2026)                                                                           |
| `@open-spaced-repetition/sm-2` | SM-2            | 0 deps; from same org                                | SM-2 is materially worse (FSRS-5 reduces daily reviews ~25% for same retention); roadmap example points to FSRS |
| `supermemo` (VienDinhCom)      | SM-2            | 331 stars; mature                                    | 1987-era algorithm; same accuracy gap as above                                                                  |
| `@x1ee7/sm2-spaced-repetition` | SM-2            | 0 deps; new                                          | New, no ecosystem traction                                                                                      |

## Decision

Use `ts-fsrs` unless `/10x-plan` surfaces a constraint that flips the call. Concrete fallback if ts-fsrs misbehaves on Workers: `@squeakyrobot/fsrs` (explicit CF Workers support) or `quanta-fsrs`.
