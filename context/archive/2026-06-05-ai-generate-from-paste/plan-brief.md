# Paste-to-AI-cards Generation — Plan Brief

> Full plan: `context/changes/ai-generate-from-paste/plan.md`

## What & Why

Ship the product wedge: a logged-in user pastes up to 6 000 characters into the dashboard, gets up to 30 AI-generated flashcards saved to their deck in a few seconds, and sees them rendered read-only below the textarea. The PRD names "copy-paste-first AI generation" as the one trait that, removed, makes 10xCards indistinguishable from every other flashcard tool. This slice is also the highest-technical-risk slice in the must-have set: the infrastructure risk register flags CPU-time exhaustion and Workers subrequest-cap breach on long pastes as Medium-likelihood / High-impact, so sequencing it under `main_goal: speed` surfaces those risks in week 1 instead of week 3.

## Starting Point

F-01 (`cards-schema-baseline`) is archived: the `cards` table, four RLS policies, the generated TypeScript types, and the Supabase migration + codegen pipeline are all in place. The Supabase SSR client and the auth middleware are wired; `/dashboard` is protected. No LLM client, no `src/pages/api/cards/*`, no Zod, no shadcn `textarea`/`alert` — this slice is greenfield in an established repo.

## Desired End State

A signed-in user navigates to `/dashboard`, pastes a block of text, clicks "Generate flashcards", sees an in-flight progress bar with rotating English step labels for the full duration of the LLM call, and within seconds sees a read-only list of the newly created cards plus an English success toast "Saved N cards to your deck". Pasting again replaces the on-screen list; the textarea clears each time. Failures (LLM invalid output, DB error, auth missing) surface a single English error toast and save nothing. Anonymous requests to `POST /api/cards/generate` return 401. No code path logs or persists the raw pasted text beyond the derived `front`/`back` columns, verified by a documented four-point audit.

## Key Decisions Made

| Decision                    | Choice                                                                               | Why (1 sentence)                                                                                                                                  | Source |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| LLM provider                | OpenRouter                                                                           | Single API surface fronting multiple model vendors, matches `OPENROUTER_API_KEY` already named in `infrastructure.md`.                            | Plan   |
| Model tier (default)        | Small/fast (default `openai/gpt-4o-mini`), configurable via `OPENROUTER_MODEL`       | ~10× cheaper than frontier; 2–8 s latency for ≤30-card extraction; cost ceiling realistic for after-hours MVP; swap requires no code change.      | Plan   |
| LLM output shape            | `response_format: { type: 'json_schema', strict: true }`                             | Vendor-enforced structural validity; eliminates fragile regex parsing; clean failure mode (Zod parse) instead of partial bad output.              | Plan   |
| API shape                   | `POST /api/cards/generate` JSON in, JSON out, with `{ ok, cards?, error? }` envelope | Card generation is data, not navigation; first JSON endpoint, sets a precedent that distinguishes it from the auth-route formData/redirect style. | Plan   |
| In-flight progress UX       | Indeterminate progress bar + 3 rotating English phase labels                         | Satisfies NFR-1 (ack < 2 s + visible progress for duration); zero server work; no SSE; "visible progress" reads better than a spinner.            | Plan   |
| Hard cap                    | 30 cards / 6 000 chars                                                               | Conservative against Workers CPU + subrequest budget; one bulk insert = one subrequest; matches infrastructure.md mitigation intent.              | Plan   |
| LLM failure handling        | No retry, fail fast                                                                  | Simpler; predictable cost; user re-pastes; aligns with US-01 fallback (manual creation comes from S-02).                                          | Plan   |
| DB failure handling         | Atomic — fail the whole request, no partial save                                     | `supabase.from('cards').insert(arr)` is one Postgres statement; respects Guardrails-2 ("never lose progress or show the wrong card").             | Plan   |
| Validation library          | Zod (request body + LLM output)                                                      | Typesafe runtime validation; one schema serves both the OpenRouter `json_schema` and the post-receipt check; sets the convention for S-02/S-03.   | Plan   |
| Post-generation view        | Inline read-only list of the latest batch (no edit/delete)                           | S-02 owns deck management; this slice ships the wedge end-to-end without bleeding into it.                                                        | Plan   |
| Card language               | Match the language of the pasted text                                                | Zero UI for language selection; the typical user paste's language IS the card's language.                                                         | Plan   |
| After-review behaviour      | Textarea clears, list stays, next batch REPLACES the on-screen list                  | Wedge interaction is "paste, paste, paste"; no explicit "done" click; latest batch confirms each save without bleeding into S-02's deck view.     | Plan   |
| UI language                 | English (all UI text, errors, labels, toasts)                                        | User-directed override of AGENTS.md's Polish convention; flagged as Open Risk for AGENTS.md reconciliation in a separate change.                  | Plan   |
| NFR-2 audit approach        | Code-review checklist + four documented bullets in Phase 2's Manual verification     | Pragmatic for capacity-constrained MVP; deterministic checks; reviewer signs off.                                                                 | Plan   |
| Auth check in the API route | Explicit `supabase.auth.getUser()` inside the handler                                | Middleware redirects pages, not API routes; defence-in-depth for direct programmatic calls.                                                       | Plan   |

## Scope

**In scope:**

- `src/lib/llm/openrouter.ts` + `src/lib/llm/schemas.ts` (LLM client + Zod schemas)
- `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` declared in `astro.config.mjs`, documented in `.dev.vars.example` / README / AGENTS.md
- `POST /api/cards/generate` JSON endpoint with bulk insert under RLS
- `src/components/cards/PasteToGenerate.tsx` React island on `/dashboard`
- `src/components/ui/textarea.tsx` and `src/components/ui/alert.tsx` shadcn primitives
- `zod` added as a runtime dependency
- NFR-2 privacy audit (four documented checks) in Phase 2

**Out of scope:**

- Editing / deleting cards (S-02)
- Full deck list, search, pagination (S-02)
- Manual card creation form (S-02, FR-005)
- Spaced-repetition session (S-03)
- Streaming LLM output (SSE)
- Per-user rate limits / quotas
- Retry on LLM failure
- Partial save on DB failure
- 75 % acceptance-rate / creation-rate metrics
- Reconciling AGENTS.md's Polish-UI convention
- Adding a test runner

## Architecture / Approach

```
┌────────────────────────────────────────────────────────────────────────┐
│ /dashboard.astro (Astro page, gated by middleware to logged-in users)  │
│   └── <PasteToGenerate client:load /> (React island, all English UI)   │
│         ├─ textarea (maxLength=6000) + live counter                    │
│         ├─ "Generate flashcards" button                                │
│         ├─ indeterminate progress bar + 3-phase English labels         │
│         ├─ success toast / error toast                                 │
│         └─ read-only list of latest batch (front/back per card)        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ fetch POST { text }
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ POST /api/cards/generate (Astro API route, JSON in/out)                │
│   1. Zod-validate { text } (length 1..6000) → 400 on fail              │
│   2. supabase.auth.getUser() → 401 if no session                       │
│   3. generateCardsFromText(text) → 502 LLM_FAILURE on any throw       │
│   4. supabase.from('cards').insert(rows).select() (single bulk stmt)   │
│      → 500 DB_INSERT_FAILED on error                                   │
│   5. 200 { ok: true, cards: [...] }                                    │
│   (No console.* of text / LLM I/O anywhere in this path.)              │
└─────────┬──────────────────────────────────┬───────────────────────────┘
          │                                  │
          ▼                                  ▼
┌────────────────────────┐    ┌──────────────────────────────────────────┐
│ OpenRouter API         │    │ Supabase (RLS-scoped via cookied SSR     │
│ chat/completions       │    │ client; user_id = auth.uid())            │
│ response_format:       │    │ public.cards table (from F-01)           │
│   json_schema, strict  │    │                                          │
└────────────────────────┘    └──────────────────────────────────────────┘
```

## Phases at a Glance

| Phase                                               | What it delivers                                                                                       | Key risk                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1. LLM client + Zod schemas + env wiring            | `src/lib/llm/openrouter.ts`, schemas, two new env vars declared; `zod` dep added                       | OpenRouter model availability drift; chosen default may not support strict `json_schema` — verify at impl-time |
| 2. `POST /api/cards/generate` endpoint              | JSON in/out route with Zod input, auth gate, LLM call, atomic bulk insert; **NFR-2 audit (4 bullets)** | Privacy regression — a stray `console.error` of paste/LLM I/O would silently violate Guardrails-1 / NFR-2      |
| 3. Dashboard paste island + read-only post-gen list | `PasteToGenerate.tsx`, shadcn `textarea`+`alert`, English UX throughout, progress bar + toasts         | UX-only: the indeterminate progress with time-based phase rotation can feel inaccurate on very long pastes     |

**Prerequisites:** F-01 (`cards-schema-baseline`) — done, archived 2026-06-05. Supabase + Cloudflare Workers running locally and deployed; ability to set Workers secrets via `npx wrangler secret put`; an OpenRouter API key.
**Estimated effort:** ~3 evening sessions across the 3 phases; sequential (each phase manually verified before the next).

## Open Risks & Assumptions

- **AGENTS.md / English UI tension**: this slice ships English UI; AGENTS.md still says Polish. Reconcile in a separate change.
- **OpenRouter model drift**: the default `openai/gpt-4o-mini` may be deprecated or renamed by impl-time; verify and adjust the default in `src/lib/llm/openrouter.ts`.
- **`json_schema` strict support**: not every OpenRouter model honours strict json_schema; if the chosen default doesn't, fall back to `response_format: { type: 'json_object' }` + Zod parse — same control flow, slightly less reliable upstream.
- **No automated tests**: the NFR-2 audit is hand-checked; a future PR could re-introduce a `console.log` of paste text silently. Mitigation: include the audit in `/10x-impl-review`'s checklist.
- **Wrangler observability default behaviour**: assumes `observability.enabled: true` records metadata but not request bodies, per current Cloudflare docs. Re-verify if Cloudflare changes the default.

## Success Criteria (Summary)

- A signed-in user can paste up to 6 000 characters, click "Generate flashcards", and see up to 30 newly created cards appear in a read-only list within seconds (NFR-1: ack < 2 s + visible progress throughout).
- All generated cards are persisted under RLS (other users cannot see them; verified by direct `select` while signed in as a different user — Guardrails-1).
- No log line, no Supabase row, no analytics event captures the raw pasted text or LLM I/O — verified by the documented Phase 2 audit and a `wrangler tail` smoke run (NFR-2).
- Failure modes (LLM invalid output, DB error, auth missing, input out of bounds) all surface a single English error toast and never produce a partial save (Guardrails-2).
