# Paste-to-AI-cards Generation Implementation Plan

## Overview

A logged-in user pastes a block of text (≤ 6 000 characters) into the dashboard, clicks "Generate", and within seconds gets up to 30 AI-generated flashcards saved directly to their deck and rendered as a read-only list below the textarea. This slice ships the product wedge end-to-end: paste → AI extracts question/answer pairs → cards are persisted under RLS → user sees confirmation. Editing, deleting, and full deck management land later with S-02.

## Current State Analysis

- **Cards schema is ready**: `supabase/migrations/20260605112924_cards_baseline.sql:3-30` defines `cards(id, user_id, front, back, created_at)` with four RLS policies gating on `user_id = auth.uid()`. Typed via `src/db/database.types.ts` (`Tables<'cards'>`, `TablesInsert<'cards'>`).
- **Supabase SSR client is ready**: `src/lib/supabase.ts:6-25` exposes `createClient(headers, cookies)` returning a request-scoped, cookied client typed to the generated `Database`. RLS is the access-control gate; service-role key is not used and not declared.
- **Auth middleware is wired**: `src/middleware.ts:6-24` populates `context.locals.user` on every request but only redirects unauth users away from page routes listed in `PROTECTED_ROUTES`. **API routes do not auto-redirect** — each route must call `supabase.auth.getUser()` itself.
- **No card-generation code exists anywhere**: no LLM client, no `src/pages/api/cards/*`, no shared response/validation helpers. This slice is greenfield within an established repo.
- **Existing API route pattern is form-encoded + redirect** (`src/pages/api/auth/signin.ts:1-20`). This slice introduces the first JSON-in/JSON-out route — a deliberate new pattern fit for a non-navigational interaction.
- **Env schema uses `astro:env/server`** (`astro.config.mjs:17-23`). Only `SUPABASE_URL` and `SUPABASE_KEY` are declared today; `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are added by this slice.
- **shadcn registry is partial**: only `src/components/ui/button.tsx` exists. `textarea` and `alert` primitives need to be added.
- **No test runner**; CI runs lint + `astro sync` + Supabase up + `db reset` + `db:types` drift-check + build (`.github/workflows/ci.yml:14-34`). Manual smoke tests are the gating mechanism per project convention.
- **Cloudflare Workers deploy is live** on the Standard $5/mo plan (per infrastructure.md). The 30 s CPU default and 1 000 subrequests/invocation cap are the budget this slice must stay inside.

### Key Discoveries:

- `supabase.from('cards').insert(array).select()` is a **single** subrequest and a **single** Postgres statement → bulk insert is atomic; partial saves are impossible. This is what makes "fail the whole request on DB error" safe (`supabase/migrations/20260605112924_cards_baseline.sql`, RLS policies preserve isolation per row).
- `infrastructure.md:57-88` enumerates the exact failure mode this slice must prevent (per-card insert loop → subrequest cap + CPU exhaustion). The fix is naming it loudly and writing the route to do one insert.
- F-01's impl-review (`context/archive/2026-06-05-cards-schema-baseline/impl-review.md:84-85`) reaffirms: never use `SUPABASE_SERVICE_ROLE_KEY` — every write goes through the cookied SSR client.
- `context.locals.user` is set by middleware **for pages**, but the canonical API-route auth check is `await supabase.auth.getUser()` inside the route (`src/pages/api/auth/signin.ts:9-13` demonstrates the client creation pattern). The dashboard page is already gated to logged-in users, so the API check is a defence-in-depth measure that also covers direct programmatic calls.
- AGENTS.md states UI is in Polish, but the user has explicitly overridden this for the application's content as part of this planning conversation — **all UI text in this slice is in English**. Reconciling AGENTS.md with the new convention is outside the slice's scope but flagged in `## Open Risks & Assumptions`.

## Desired End State

- A user at `/dashboard` can paste up to 6 000 characters of text, click "Generate", see a progress bar with rotating step labels for the full duration of the LLM call, then see a read-only list of the just-generated flashcards (front + back per card) plus an English success toast saying how many were saved.
- The cards are persisted to `public.cards` with `user_id` = the authenticated user's id; RLS guarantees no other user can read them.
- Pasting again replaces the on-screen list with the new batch; previous cards remain in the deck (visible later via S-02).
- A failed LLM call (invalid JSON, schema mismatch, rate limit, network) or a Supabase insert failure surfaces a single English error toast; no partial save occurs and the textarea retains the user's text so they can retry without re-pasting.
- An anonymous client calling `POST /api/cards/generate` directly receives HTTP 401 with a JSON error envelope.
- No code path in `src/pages/api/cards/`, `src/lib/llm/`, or `src/components/cards/` logs, persists, or transmits the raw pasted text or LLM I/O strings to any operator-accessible destination beyond the derived `front`/`back` columns — verified by a four-point audit documented in Phase 2.
- `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are declared in `astro.config.mjs`, set in `.dev.vars` for local dev, and set via `npx wrangler secret put` in production.

### Verification:

- Sign in, paste a ~2 000-char text excerpt, see cards appear within seconds, confirm rows in Supabase Studio (`http://127.0.0.1:54321` for local dev).
- Sign out, retry the POST via curl → 401.
- Stream `npx wrangler tail` against a deployed paste flow and grep the output for any substring of the paste — must produce zero hits.
- CI is green on `npm run lint`, `npx astro check`, `npm run build`, and the existing `git diff --exit-code src/db/database.types.ts` types-in-sync guardrail.

## What We're NOT Doing

- **Editing or deleting cards** — owned by S-02 (`deck-management`).
- **Full deck list / pagination / search** — owned by S-02. This slice only renders the latest just-generated batch.
- **Spaced-repetition session** — owned by S-03.
- **Manual card creation form** — owned by S-02 (FR-005 fallback path).
- **Per-batch undo or "redo with different prompt"** — out of scope; the user re-pastes if unhappy.
- **Streaming LLM output (SSE) / determinate progress** — deferred; an indeterminate progress bar with rotating labels is sufficient for NFR-1.
- **Retry on LLM failure** — user-confirmed: fail fast on the first invalid output.
- **Partial-save on DB failure** — user-confirmed: atomic insert; whole request fails.
- **Tracking acceptance-rate / creation-rate as automated metrics** — roadmap Open Question #1; not formalized in this slice.
- **Reconciling AGENTS.md's Polish-UI convention** — flagged as an Open Risk; handled in a separate change.
- **Adding a test runner** — parked at the roadmap level until a real regression appears.
- **Rate limiting / per-user quotas** — not in PRD must-haves; revisit when usage data exists.
- **Multi-format input (PDF, DOCX, URL, image)** — PRD Non-Goal-2.

## Implementation Approach

Three phases, sequenced by dependency. Phase 1 builds a pure utility module that can be exercised in isolation (no route, no UI). Phase 2 wires it to a JSON HTTP route under the existing Astro + Supabase SSR pattern, and is where the NFR-2 privacy audit lives because the route is the single place pasted text crosses process boundaries. Phase 3 builds the React island and visible UX; it depends on Phase 2's contract but not on its specific implementation.

A new shared dependency, `zod`, is introduced in Phase 1. It is the validation library for both the API request body and the LLM JSON output. Once present, it becomes the convention for future slices' input validation.

## Critical Implementation Details

- **Single bulk insert, never a per-card loop.** `supabase.from('cards').insert(array).select()` is one subrequest and one Postgres statement. The Cloudflare Workers risk register (`infrastructure.md:88`) flags per-card insert loops as the high-likelihood / high-impact failure mode for this slice. If the implementer is tempted to "iterate and insert" for cleaner error reporting, the answer is no — atomicity here is the safety property that makes the "no partial save" guarantee work.
- **Auth check must live in the API route, not be assumed from middleware.** Middleware populates `context.locals.user` on pages but does not redirect on API routes; a route that skips `supabase.auth.getUser()` would let an anonymous request reach the LLM call. Pattern: create the SSR client at the top of the handler, call `getUser()`, return 401 immediately if `!user`.
- **NFR-2 / privacy ordering**: never pass the request `text` or any LLM I/O string into a logged context — not into `console.*`, not into thrown `Error.message`, not into a response error envelope. Error envelopes describe the failure class (`LLM_INVALID_OUTPUT`, `DB_INSERT_FAILED`, `INPUT_TOO_LONG`, `UNAUTHORIZED`), not its contents. Error stack traces from Zod parse failures are particularly risky because Zod includes received values by default — strip via `.safeParse()` + custom envelope, do not throw the parse result.

## Phase 1: LLM client + Zod schemas + env wiring

### Overview

Add `zod` as a runtime dependency, declare two new env vars (`OPENROUTER_API_KEY` secret + `OPENROUTER_MODEL` plain), and ship a single utility module that calls OpenRouter's chat-completions endpoint with strict JSON-schema response format and returns a Zod-validated array of `{ front, back }` cards (or throws a typed error). This phase produces no user-visible change; it is the foundation Phase 2 wires into a route.

### Changes Required:

#### 1. Add `zod` runtime dependency

**File**: `package.json`

**Intent**: Add `zod` to `dependencies`. Run `npm install zod` so `package-lock.json` updates.

**Contract**: New entry under `"dependencies"` in `package.json`; matching entry in `package-lock.json`. No version pin beyond a caret on the current major.

#### 2. Declare new env vars

**File**: `astro.config.mjs`

**Intent**: Extend the existing `env.schema` block to declare `OPENROUTER_API_KEY` (secret, server-only) and `OPENROUTER_MODEL` (public-ish identifier, server-only, with a sensible default applied in code).

**Contract**: Two new `envField.string({ context: "server", access: "secret", optional: true })` entries (optional so missing keys produce a clear runtime error in the route, matching the existing Supabase pattern). The router/UI never reads them.

#### 3. Document env vars in local-dev configuration

**Files**: `.dev.vars.example` (create if absent), `README.md`, `AGENTS.md`

**Intent**: Document the two new env vars next to the existing Supabase ones so a contributor on a fresh checkout can run `npm run dev` end-to-end. The `.dev.vars` file itself is gitignored; the example mirror is committed.

**Contract**: New lines in the env-vars table / configuration section, naming the two vars and what they control. No secret values committed.

#### 4. Define Zod schemas

**File**: `src/lib/llm/schemas.ts`

**Intent**: Define the two schemas the rest of the slice depends on, plus their inferred TypeScript types.

**Contract**:

- `GenerateRequestSchema` — `z.object({ text: z.string().min(1).max(6000) })`.
- `GeneratedCardSchema` — `z.object({ front: z.string().min(1).max(1000), back: z.string().min(1).max(1000) })`.
- `GeneratedCardsSchema` — `z.array(GeneratedCardSchema).min(1).max(30)`.
- Exported types: `GenerateRequest`, `GeneratedCard`, `GeneratedCards`.
- The min/max bounds mirror the cards-table CHECK constraints and the slice's hard caps so validation rejection happens before Postgres sees a bad row.

#### 5. Implement OpenRouter client

**File**: `src/lib/llm/openrouter.ts`

**Intent**: Export one async function `generateCardsFromText(text: string): Promise<GeneratedCard[]>` that calls OpenRouter's `/api/v1/chat/completions` endpoint with the configured model, a system prompt instructing the model to detect the source language and produce front/back pairs in that language (max 30 cards), and `response_format: { type: 'json_schema', json_schema: { name: 'cards', strict: true, schema: ... } }`. On a successful 2xx response, parse the assistant message JSON, validate with `GeneratedCardsSchema.safeParse`, and return the array. On any failure path — non-2xx, missing assistant content, JSON parse failure, Zod validation failure — throw a typed error whose message is a stable code string (no LLM I/O substring), one of: `LLM_HTTP_ERROR`, `LLM_EMPTY_RESPONSE`, `LLM_INVALID_OUTPUT`.

**Contract**:

- Function signature: `export async function generateCardsFromText(text: string): Promise<GeneratedCard[]>`.
- Reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from `astro:env/server`; if either is missing, throw `LLM_NOT_CONFIGURED`.
- Default model when `OPENROUTER_MODEL` is unset: `openai/gpt-4o-mini` (small/fast tier, strong json_schema support). The implementer should confirm availability on OpenRouter at implementation time and adjust if deprecated.
- Errors are plain `Error` instances whose `.message` IS the code (e.g. `throw new Error('LLM_INVALID_OUTPUT')`) — no PII or paste-substring leakage. Implementer may attach a `cause` field for non-production debugging but must not stringify the LLM I/O into the cause's message.
- The fetch uses `signal: AbortSignal.timeout(45_000)` to bound the call inside the Workers 30 s CPU budget plus a margin (the wall-clock isn't billed, but a runaway request still blocks the user).

### Success Criteria:

#### Automated Verification:

- `npm install` completes; `zod` appears in `package.json` and `package-lock.json`.
- `npm run lint` passes.
- `npx astro check` passes — confirms env schema and new module typecheck.
- `npm run build` passes against a local `.dev.vars` that has the two new vars set (test values; not exercised at build time).

#### Manual Verification:

- With real `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.dev.vars`, calling `generateCardsFromText("Mitochondria are the powerhouse of the cell. ATP is produced via oxidative phosphorylation.")` from a temporary `npm run dev` scratch script returns a `GeneratedCard[]` of length 1–30 with non-empty `front` and `back`.
- The same scratch call with `OPENROUTER_API_KEY` deliberately wrong throws an `Error` whose `.message === 'LLM_HTTP_ERROR'`, not containing the paste text.
- The `.dev.vars.example` file shows the two new vars with placeholder values; README/AGENTS.md mention them in the local-setup section.

**Implementation Note**: After this phase passes automated verification, pause for manual confirmation that the OpenRouter call works against a real key before proceeding. Phase 2 cannot be verified without a working Phase 1.

---

## Phase 2: POST /api/cards/generate endpoint

### Overview

New JSON-in/JSON-out Astro API route. It takes `{ text }` in the body, Zod-validates it, requires an authenticated Supabase session, calls the Phase-1 LLM client, performs a single bulk insert into `public.cards`, and returns the inserted rows. This is the only code path in the slice where pasted text crosses a process boundary — so the NFR-2 audit lives in this phase's Manual verification.

### Changes Required:

#### 1. Create the API route

**File**: `src/pages/api/cards/generate.ts`

**Intent**: Implement a `POST` handler that orchestrates: parse JSON body → Zod-validate → resolve user via SSR client → call `generateCardsFromText` → map to `TablesInsert<'cards'>` with `user_id` from the session → single `supabase.from('cards').insert(rows).select()` → return inserted rows as JSON. Returns a uniform success/error envelope.

**Contract**:

- Export: `export const POST: APIRoute = async (context) => { ... }`.
- Success response: HTTP 200, `Content-Type: application/json`, body `{ ok: true, cards: Array<{ id, front, back, created_at }> }`.
- Error envelope: HTTP `<status>`, `Content-Type: application/json`, body `{ ok: false, error: { code: string, message: string } }`. The `message` is a generic human-readable string in English (e.g. `"Generation failed. Please try again."`), NOT a verbatim error from Zod or the LLM client; the `code` is a machine-readable stable token.
- Error mapping:
  - Body not JSON or missing `text` → 400 `INVALID_REQUEST`.
  - Zod rejection (length out of bounds) → 400 `INPUT_TOO_LONG` (or `INPUT_TOO_SHORT`) — distinguished by which bound failed.
  - `supabase.auth.getUser()` returns no user → 401 `UNAUTHORIZED`.
  - `generateCardsFromText` throws → 502 `LLM_FAILURE` (collapse `LLM_HTTP_ERROR` / `LLM_EMPTY_RESPONSE` / `LLM_INVALID_OUTPUT` / `LLM_NOT_CONFIGURED` into one client-visible code; the original code stays in server-side handling but is NOT echoed to the client).
  - Supabase insert error → 500 `DB_INSERT_FAILED`.
- The handler must NOT call `console.log` / `console.error` with the request body, the LLM input, the LLM output, or any substring thereof. Logging is allowed for: HTTP status, error code, card count.
- The Supabase insert is a single statement: `supabase.from('cards').insert(rows).select('id, front, back, created_at')` where `rows` is `GeneratedCard[]` with `user_id` injected from the authenticated session. No iteration, no per-card insert.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro check` passes — confirms typed Supabase client usage and the route signature.
- `npm run build` passes.
- The CI types-in-sync guardrail (`git diff --exit-code src/db/database.types.ts`) is unaffected — this phase adds no migrations.

#### Manual Verification:

- **Happy path**: signed-in user → `curl -X POST http://localhost:4321/api/cards/generate -H 'Content-Type: application/json' -d '{"text":"<~2000 chars>"}'` returns 200 with `{ ok: true, cards: [...] }`; `select * from public.cards where user_id = <my uid>` in Supabase Studio shows the new rows.
- **Anonymous**: same `curl` with no cookie → 401 `UNAUTHORIZED`.
- **Empty text**: `{"text":""}` → 400 `INPUT_TOO_SHORT`.
- **Oversized text**: `{"text":"<6001 chars>"}` → 400 `INPUT_TOO_LONG`.
- **Bad JSON**: `-d 'not json'` → 400 `INVALID_REQUEST`.
- **LLM failure simulation** (point `OPENROUTER_MODEL` to a non-existent model id or wipe `OPENROUTER_API_KEY`): valid request → 502 `LLM_FAILURE`; `select count(*) from public.cards where user_id = <my uid>` BEFORE and AFTER are equal — no partial save.
- **Privacy audit (NFR-2)** — performed and documented in the PR description:
  1. `rg -n 'console\\.(log|error|warn|info|debug)' src/pages/api/cards/ src/lib/llm/` → zero matches that pass the request body, LLM input, or LLM output as an argument.
  2. The `cards` table contains no column storing the raw paste text — verified by reading `supabase/migrations/20260605112924_cards_baseline.sql` against the rows inserted in the happy-path test.
  3. `wrangler.jsonc`'s `observability` configuration is inspected: `enabled: true` is on, but no `head_sampling_rate` / `logs.invocation_logs` setting captures request bodies (default behaviour records metadata, not bodies — confirmed against the Cloudflare docs at the time of implementation).
  4. No analytics / telemetry SDK is imported anywhere under `src/pages/api/cards/` or `src/lib/llm/` — verified by `rg -n "import" src/pages/api/cards/ src/lib/llm/` returning only `astro:env/server`, `@/lib/supabase`, `@/lib/llm/*`, `astro`, and `zod`.
- **Deployed tail audit**: `npx wrangler tail --format pretty` against a preview deployment while running one happy-path paste → no substring of the pasted text appears in the live log stream.

**Implementation Note**: After this phase passes both automated and manual verification (including all four privacy-audit bullets), pause for sign-off before moving to Phase 3. The audit must be re-run if Phase 3 adds any new logging or telemetry near the request lifecycle.

---

## Phase 3: Dashboard paste UI + read-only post-gen list

### Overview

A React island mounted on `/dashboard` that owns the textarea, the in-flight progress UX, the success/error feedback, and the read-only list of the most recent batch. Calls the Phase-2 endpoint and renders its response. All UI text is English.

### Changes Required:

#### 1. Add shadcn primitives

**Files**: `src/components/ui/textarea.tsx`, `src/components/ui/alert.tsx`

**Intent**: Add the two missing shadcn-style primitives the island uses. Follow the existing `button.tsx` shape (`cva`-based variants, Tailwind + `cn()` from `@/lib/utils`). Pull canonical implementations from the shadcn registry; minor adjustments allowed to match the project's `cn()` helper.

**Contract**: Each file exports a default React component compatible with the matching shadcn usage (`<Textarea ... />` taking `ref`, `className`, all standard `<textarea>` props; `<Alert variant="default" | "destructive">` plus `<AlertTitle>` / `<AlertDescription>` subcomponents).

#### 2. Build the paste island

**File**: `src/components/cards/PasteToGenerate.tsx`

**Intent**: A React component (client-side state, fetch, render). It owns the textarea, a live character counter, the generate button, the progress UX, the success/error feedback, and the read-only list of the most recent batch. Calls `POST /api/cards/generate` with `{ text }`.

**Contract**:

- Default-exported React component, hydrated `client:load`.
- Local state (React useState): `text: string`, `status: 'idle' | 'submitting' | 'success' | 'error'`, `phase: 0 | 1 | 2`, `cards: { id, front, back }[]`, `errorMessage: string | null`.
- Textarea: `maxLength={6000}`, placeholder `"Paste text to generate flashcards…"`. Below it, a character counter `"{text.length} / 6000"` — turns red when over the limit (defence; maxLength also enforces).
- Submit button text: `"Generate flashcards"`. Disabled when `text.length === 0 || text.length > 6000 || status === 'submitting'`. (Empty/short cases are guarded server-side too.)
- On submit: set `status='submitting'`, `phase=0`, clear `errorMessage`; kick off a `setTimeout`-driven phase rotator (e.g. switch to phase 1 after ~2 s, phase 2 after ~12 s — heuristic; the bar itself is indeterminate); `fetch('/api/cards/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })`.
- On success (`response.ok && body.ok === true`): clear the textarea, replace `cards` with the new batch, set `status='success'`, show an English success toast `"Saved N cards to your deck"` (where N = `body.cards.length`).
- On failure (`!response.ok` OR `body.ok === false`): leave the textarea intact, set `status='error'`, set `errorMessage` to a generic English string mapped from `body.error.code` (`UNAUTHORIZED` → `"Please sign in to generate cards."`, `INPUT_TOO_LONG` / `INPUT_TOO_SHORT` → `"Text must be between 1 and 6000 characters."`, `LLM_FAILURE` → `"Generation failed. Please try again."`, `DB_INSERT_FAILED` → `"Saving failed. Please try again."`, `INVALID_REQUEST` or unknown → `"Something went wrong. Please try again."`).
- Progress bar: an indeterminate striped/animated Tailwind bar (pure CSS, no library); above it, a status line rendering one of three English labels based on `phase`: `"Sending text to AI…"` (phase 0) → `"Generating cards…"` (phase 1) → `"Saving to your deck…"` (phase 2). The bar + label show whenever `status === 'submitting'` and hide otherwise — visible within the first React render after submit (well inside the NFR-1 2 s acknowledgement).
- Read-only list: when `cards.length > 0`, render a list (one row per card) showing `front` and `back` as plain text. No edit/delete buttons. Heading: `"Latest batch"`. When the user submits again, the new batch replaces this list.
- The component does NOT persist `cards` to localStorage / sessionStorage — only the most recent batch in React state. On a page reload, the list resets (cards remain in Supabase; S-02 will eventually display them).
- The component does NOT log the `text` value, the LLM response, or the error response body to `console.*`.

#### 3. Mount the island on the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Replace (or augment) the current placeholder dashboard body so it renders the `PasteToGenerate` island. Keep the existing email + sign-out affordance.

**Contract**: Add `import PasteToGenerate from "@/components/cards/PasteToGenerate";` to the front-matter; in the page body, render `<PasteToGenerate client:load />` inside the existing `Layout`. Existing sign-out form stays.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes.
- `npx astro check` passes — confirms Astro page + React island typecheck.
- `npm run build` passes.

#### Manual Verification:

- **Logged-in render**: signing in and navigating to `/dashboard` shows the textarea, the character counter `"0 / 6000"`, and an enabled-but-greyed `"Generate flashcards"` button (disabled when text is empty).
- **Anonymous gate**: signing out and visiting `/dashboard` → redirected to `/auth/signin` (existing middleware behaviour; unchanged).
- **Live counter**: typing characters updates the counter; pasting > 6000 chars caps at 6000 (textarea `maxLength`) and the counter turns red.
- **Disabled-while-submitting**: clicking generate disables the button until the response returns.
- **Progress UX**: clicking generate immediately (< 2 s) shows the progress bar and the first English label `"Sending text to AI…"`; the label rotates through the other two labels for the duration of the call.
- **Happy path**: with a ~2 000-char paste, after the call resolves the textarea clears, the read-only list appears showing each card's front and back, and a success toast `"Saved N cards to your deck"` is shown (where N matches the response).
- **Replace-on-next-batch**: pasting again and clicking generate replaces the list (no concatenation).
- **LLM failure**: with `OPENROUTER_API_KEY` unset in `.dev.vars`, clicking generate surfaces the English error toast `"Generation failed. Please try again."`; textarea text is preserved; no list shown; no rows in Supabase.
- **Input bounds**: pasting 6001 chars (e.g. via DevTools paste-event bypass of maxLength) → server returns `INPUT_TOO_LONG` and the user sees the `"Text must be between 1 and 6000 characters."` error.
- **Privacy re-check**: while a happy-path run is in flight, opening DevTools Network → request payload shows `{ text: "..." }`; opening DevTools Console shows no `console.*` output from the island or its imports referencing the pasted text or LLM output.

**Implementation Note**: After Phase 3 passes both verifications, the slice is shippable. Confirm the deployed Cloudflare URL serves the new dashboard before announcing.

---

## Testing Strategy

### Automated:

The project has no test runner; verification gates are `npm run lint`, `npx astro check`, `npm run build`, and the CI `db reset` + `db:types` diff. Each phase's Automated Verification list above is the full automated bar.

### Manual:

Each phase's Manual Verification list is the gate. Phase 2 owns the NFR-2 privacy audit's four documented checks (grep, schema review, observability config inspection, telemetry-imports grep) plus a `wrangler tail` re-confirmation against a deployed preview.

### Smoke flow end-to-end (after Phase 3):

1. Sign in.
2. Paste a 2 000-char excerpt; click generate; observe progress UX; see cards appear; see success toast.
3. Paste again; observe replace-on-next-batch behaviour.
4. Force `OPENROUTER_API_KEY` to wrong; paste; see English error toast; no DB rows added.
5. Sign out; `curl POST /api/cards/generate` → 401.
6. `wrangler tail --format pretty` while running step 2 → grep the live log for any substring of the paste; expect zero matches.

## Performance Considerations

- **CPU budget on Workers Standard ($5/mo)**: 30 s default, 5 min max per invocation. The route does: JSON parse of a ≤ 6 kB body (fast), an `await fetch` to OpenRouter (CPU-free while waiting), JSON parse of an ≤ ~10 kB response (fast), Zod validation (fast), one Supabase insert (CPU-free while waiting), JSON response. Comfortably inside 30 s for a small-tier model.
- **Subrequest count per route invocation**: 1 (LLM call) + 1 (Supabase insert) + the Supabase auth-getUser call (1) + cookie roundtrips internal to the SSR client ≈ 3-4 total. Well under the 1 000 cap.
- **Bulk insert**: critical. A per-card insert loop on a 30-card batch is 30 subrequests + 30 statements; not a measurable problem at 30 cards but the wrong pattern to leave in the codebase (it scales linearly into the failure mode the infra doc warned about).
- **Client-side**: the React island's progress phases are `setTimeout`-driven and do not block the response; they run alongside the in-flight `fetch`. The `useFormStatus` pattern used in auth forms is not used here because the call is not a `<form action>` submission.

## Migration Notes

No database migrations in this slice — F-01 already provides the `cards` table and RLS. The only "migration-like" concern is the environment-variable rollout: production must have `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` set via `npx wrangler secret put` before the route is deployed, otherwise the first paste returns a 502.

Sequence at deploy time:

1. `npx wrangler secret put OPENROUTER_API_KEY` (and same for `OPENROUTER_MODEL`).
2. `npm run build && npx wrangler deploy`.
3. Smoke-test the deployed URL.

Rollback: `npx wrangler rollback [VERSION_ID]` reverts the route. Note (per infrastructure.md): the rolled-back code runs with current secrets, so a rotated `OPENROUTER_API_KEY` is fine on rollback. No DB rollback is needed because there are no migrations.

## References

- Roadmap entry: `context/foundation/roadmap.md:77-90` (S-01)
- PRD: `context/foundation/prd.md:47-58` (US-01), `:77-79` (FR-004), `:106-110` (NFR-1/NFR-2)
- Change identity: `context/changes/ai-generate-from-paste/change.md`
- Foundation: `context/archive/2026-06-05-cards-schema-baseline/` (F-01 plan, impl-review)
- Cards schema: `supabase/migrations/20260605112924_cards_baseline.sql`
- Generated types: `src/db/database.types.ts`
- Existing API-route pattern (for diff against the new JSON pattern): `src/pages/api/auth/signin.ts:1-20`
- Supabase SSR client: `src/lib/supabase.ts`
- Middleware: `src/middleware.ts`
- Infrastructure constraints + risk register: `context/foundation/infrastructure.md:33-96`
- Tech stack: `context/foundation/tech-stack.md`
- Lessons (no-lodash rule applies): `context/foundation/lessons.md`

## Open Risks & Assumptions

- **AGENTS.md / English UI tension**: the user explicitly directed this slice's UI to be English, but `AGENTS.md` still states the project's UI is Polish. The slice ships English; reconciling AGENTS.md (update it to "English" or carve out an exception) is a separate change. If a future contributor lands a Polish translation pass after seeing AGENTS.md, this slice's labels will need to stay English by explicit decision — flag at review time.
- **OpenRouter model availability drift**: the default `openai/gpt-4o-mini` is a 2024-era small model; OpenRouter's catalogue churns. The implementer should confirm the exact model id is live and supports `response_format: { type: 'json_schema', strict: true }` at implementation time and adjust the default if needed.
- **No automated test coverage**: per `top_blocker: capacity`, the project's stance is hand-verified MVP. The NFR-2 privacy audit in Phase 2 is the most fragile of the slice's manual gates — a future PR that adds `console.error` to the route would re-introduce the leak silently. Mitigation: include the four-point audit in `/10x-impl-review`'s checklist when running it on this change.
- **`response_format` JSON-schema model coverage**: not all OpenRouter-hosted models support strict json_schema. The plan assumes the chosen model does; if the implementer needs to fall back to a model that doesn't, the LLM client must switch to `response_format: { type: 'json_object' }` + Zod parse — same control flow, slightly less reliable upstream, no API-contract change.
- **Wrangler observability default behaviour**: the plan asserts (consistent with Cloudflare docs as of 2026-Q2) that `observability.enabled: true` records invocation metadata but not request/response bodies. If a future Cloudflare release changes this default, the NFR-2 audit's bullet 3 must be re-verified.

## Implementation Addenda

> Discovered during implementation; appended after the plan was authored to keep the plan honest as a source of truth.

- **Error code `SERVER_MISCONFIGURED` (500)** added to `src/pages/api/cards/generate.ts`. Returned when `createClient()` in `src/lib/supabase.ts` resolves to `null` because `SUPABASE_URL` / `SUPABASE_KEY` env vars are unset. Defence-in-depth — the dashboard route is already gated by middleware, so this path is only reachable on a deployment-config mistake. The client-visible `message` is the same generic `"Something went wrong. Please try again."` mapped to `INVALID_REQUEST` on the React island, so no new UI branch is required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: LLM client + Zod schemas + env wiring

#### Automated

- [x] 1.1 `npm install` completes; `zod` appears in `package.json` and `package-lock.json` — c22bd4b
- [x] 1.2 `npm run lint` passes — c22bd4b
- [x] 1.3 `npx astro check` passes — c22bd4b
- [x] 1.4 `npm run build` passes — c22bd4b

#### Manual

- [x] 1.5 `generateCardsFromText` returns a Zod-valid `GeneratedCard[]` against a real OpenRouter key — c22bd4b
- [x] 1.6 `generateCardsFromText` throws `LLM_HTTP_ERROR` on a deliberately wrong key, message contains no paste substring — c22bd4b
- [x] 1.7 `.dev.vars.example`, README, AGENTS.md reflect the two new env vars — c22bd4b

### Phase 2: POST /api/cards/generate endpoint

#### Automated

- [x] 2.1 `npm run lint` passes — 93c98a7
- [x] 2.2 `npx astro check` passes — 93c98a7
- [x] 2.3 `npm run build` passes — 93c98a7
- [x] 2.4 CI `git diff --exit-code src/db/database.types.ts` types-in-sync guardrail still passes — 93c98a7

#### Manual

- [x] 2.5 Happy path: signed-in `curl` returns 200 + cards; Supabase Studio shows the new rows — 93c98a7
- [x] 2.6 Anonymous `curl` → 401 `UNAUTHORIZED` — 93c98a7
- [x] 2.7 Empty text → 400 `INPUT_TOO_SHORT` — 93c98a7
- [x] 2.8 Oversized text → 400 `INPUT_TOO_LONG` — 93c98a7
- [x] 2.9 Bad JSON → 400 `INVALID_REQUEST` — 93c98a7
- [x] 2.10 LLM failure simulation → 502 `LLM_FAILURE`, no DB rows added — 93c98a7
- [x] 2.11 NFR-2 audit 1/4: `rg console\.` in `src/pages/api/cards/` and `src/lib/llm/` → no logging of paste / LLM I/O — 93c98a7
- [x] 2.12 NFR-2 audit 2/4: `cards` schema review confirms no column stores raw paste — 93c98a7
- [x] 2.13 NFR-2 audit 3/4: `wrangler.jsonc` `observability` config does not sample/store request bodies — 93c98a7
- [x] 2.14 NFR-2 audit 4/4: no analytics/telemetry SDK imports near the request lifecycle — 93c98a7
- [ ] 2.15 `wrangler tail` against a preview deploy shows no paste substring on a happy-path run

### Phase 3: Dashboard paste UI + read-only post-gen list

#### Automated

- [x] 3.1 `npm run lint` passes — de2863c
- [x] 3.2 `npx astro check` passes — de2863c
- [x] 3.3 `npm run build` passes — de2863c

#### Manual

- [x] 3.4 Logged-in `/dashboard` shows textarea + counter + generate button — de2863c
- [x] 3.5 Anonymous `/dashboard` → redirected to `/auth/signin` — de2863c
- [x] 3.6 Live char counter updates and turns red at the limit — de2863c
- [x] 3.7 Generate button disabled while submitting — de2863c
- [x] 3.8 Progress bar + first English label appear < 2 s after submit; labels rotate through all three phases — de2863c
- [x] 3.9 Happy path: textarea clears, read-only list appears, English success toast shows correct N — de2863c
- [x] 3.10 Replace-on-next-batch: a second generate replaces (not appends) the list — de2863c
- [x] 3.11 LLM failure: English error toast appears, textarea preserved, no list, no DB rows — de2863c
- [x] 3.12 Input-bounds bypass attempts return server-side 400 with the right English error — de2863c
- [x] 3.13 DevTools Console contains no log lines referencing the paste text or LLM output during a happy-path run — de2863c
