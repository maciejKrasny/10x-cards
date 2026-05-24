---
project: 10xCards
researched_at: 2026-05-23
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR + React 19
  runtime: Cloudflare Workers (workerd) on Node 22.14.0 in dev
---

## Recommendation

**Deploy on Cloudflare Workers.**

Five-of-five Pass on the agent-friendly criteria, the `@astrojs/cloudflare` ^13.5.0 adapter already pinned in `package.json` makes Workers the canonical Astro 6 path (Pages support was removed from the adapter), and the project is already scaffolded with `wrangler.jsonc` (`compatibility_flags: ["nodejs_compat"]`, `ASSETS` binding, observability enabled). On the operational side: Cloudflare's CPU-time-only billing means the 10–30s OpenRouter LLM call burns only the small CPU slice spent parsing the response — wall-clock-while-fetch is free — so the headline feature (FR-004) runs cheaply on the $5/mo paid plan. Interview Q3 (existing Cloudflare familiarity) breaks any remaining tie against Vercel.

## Platform Comparison

| Platform               | CLI-first | Managed | Agent-readable docs | Stable deploy API | MCP / agent | Notes                                                                       |
| ---------------------- | --------- | ------- | ------------------- | ----------------- | ----------- | --------------------------------------------------------------------------- |
| **Cloudflare Workers** | ✅        | ✅      | ✅                  | ✅                | ✅          | 5/5; LLM call works on $5 plan; user already familiar                       |
| **Vercel**             | ✅        | ✅      | ✅                  | ✅                | ⚠️          | Fluid Compute (300s) solves LLM timeout; MCP beta; Hobby is non-commercial  |
| **Fly.io**             | ✅        | ⚠️      | ✅                  | ✅                | ⚠️          | No timeout; container model overkill for stateless + external DB            |
| **Netlify**            | ✅        | ✅      | ✅                  | ⚠️                | ✅          | **Functionally disqualified**: 10s free / 26s Pro vs 30s LLM calls          |
| **Railway**            | ✅        | ⚠️      | ✅                  | ⚠️                | ⚠️          | Solid PaaS but DB co-location strength wasted with external Supabase        |
| **Render**             | ⚠️        | ⚠️      | ✅                  | ⚠️                | ✅          | Free tier sleeps (60s cold start kills first LLM call); Starter $7 required |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

- **Astro 6 path**: `@astrojs/cloudflare` ^13.5.0 is the canonical adapter — Pages support was explicitly removed. The project already runs `output: "server"` + `adapter: cloudflare()` and the wrangler bundle emits `_worker.js` via `@astrojs/cloudflare/entrypoints/server`.
- **LLM call economics**: Workers have no wall-clock limit while the client stays connected. CPU time only counts during synchronous execution — a 30s OpenRouter call burns tens of milliseconds of CPU on the response parse. Free tier CPU ceiling (10ms) is tight for any real card-extraction work; the $5/mo Workers Standard plan (30s default, 5min max CPU) is the realistic floor.
- **CLI**: `wrangler` v4 is mature — `wrangler deploy`, `wrangler tail`, `wrangler secret put`, `wrangler rollback [VERSION_ID]`. Predictable exit codes, no mid-deploy interactive prompts beyond first-time auth.
- **Docs**: best-in-class agent-readability — `llms-full.txt` at the root, per-product `llms.txt` and `llms-full.txt` files, every page available as markdown, `x-markdown-tokens` response header for context budgeting.
- **MCP**: five GA Cloudflare MCP servers (`bindings`, `observability`, `docs`, `builds`, top-level `mcp.cloudflare.com`) — agent operability is structured, not screen-scraped.
- **Familiarity**: AGENTS.md already documents `npx wrangler deploy` — the platform decision is consistent with how the project was scaffolded.

#### 2. Vercel (runner-up)

- **Astro 6 path**: `@astrojs/vercel` is GA. Fluid Compute (default-on since April 2025) gives 300s function duration on both Hobby and Pro — the 30s LLM call is comfortably inside the budget without engineering workarounds.
- **Why second**: Vercel MCP is still **public beta** as of 2026-02-12 (and notably cannot read or write environment variables — that gap is roadmap, not shipped). The Hobby plan is restricted to non-commercial personal use; if 10xCards ever monetizes, Hobby is not legally available. Switching to Vercel later requires an adapter swap and a re-test of SSR behavior — not free.
- **Where it would win**: if the team wanted zero-thought timeout handling and the most polished CLI logs experience in 2026 (`vercel logs` was rebuilt agent-optimized in Feb 2026).

#### 3. Fly.io

- **Astro 6 path**: container-based via `@astrojs/node` (standalone). `fly launch` has a known regression where it doesn't auto-generate a Dockerfile for Astro 5+ — workaround is `npx --yes @flydotio/dockerfile@latest`. You own the Dockerfile.
- **Why third**: Fly's strengths (persistent processes, raw sockets, sticky state, volumes) are unused on this stack — no WebSockets, no background workers, external DB. The container model adds a Docker tax (image builds, base-image patching) for capabilities not exercised. MCP server is **experimental** as of 2026-05-23.
- **Where it would win**: if FR-009's SR algorithm ever moved to a long-lived background worker (e.g., a daily review-batch precompute) or if WebSockets entered scope.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **CPU-time accounting is invisible until it bites.** The 30s OpenRouter call doesn't burn CPU while awaiting the response, but post-response card extraction (`JSON.parse` of the LLM response → 20–40 card objects → Supabase inserts) accrues CPU during synchronous work. A naive non-batched insert loop can silently approach the 30s CPU default before the developer notices.
2. **Subrequest cap on free tier is 50 per invocation.** One card-generation route = 1 LLM call + N Supabase writes (one per card if not batched) + auth/session lookups. A 40-card paste with per-card inserts already brushes the ceiling. Paid tier (1,000) hides the issue. Failure mode: "worked yesterday, broke today on a longer paste."
3. **Vendor lock-in via wrangler.jsonc bindings is invisible until you need to leave.** `_worker.js` output + `compatibility_flags: ["nodejs_compat"]` + adapter-provisioned `ASSETS`/`SESSION` bindings is not a Dockerfile you can drop on another host. Migrating to Vercel or Fly later is "swap adapter, re-verify SSR behavior", not "deploy elsewhere".
4. **`wrangler rollback` uses CURRENT secrets, not the secrets at the rolled-back version's deploy time.** If you rotate the OpenRouter or Supabase key as part of recovery and then roll back to a pre-rotation deploy, the rolled-back code uses the _new_ key. Usually fine; in a real incident it's a footgun.
5. **The Pages → Workers migration arc is still recent.** The Astro Cloudflare adapter explicitly dropped Pages support; you're depending on the newer Workers Static Assets path, which is GA but has fewer years of Astro-specific bug reports than the path it replaced.

### Pre-Mortem — How This Could Fail

It's November 2026. The MVP shipped in early summer and grew faster than expected — ~800 daily actives, mostly Polish learners pasting long course chapters. The card-generation endpoint started timing out for ~5% of users in October. Logs say "Exceeded CPU Time" — not the wall clock the team assumed mattered. After paste, the route awaits a ~6KB OpenRouter response, parses it, splits it into ~40 cards, and inserts each into Supabase sequentially. Each insert is a subrequest; each `JSON` shape pass burns CPU. On long pastes the route either bursts past 50 subrequests (early users still on a free-tier worker the team forgot to upgrade) or accrues 35s+ of CPU on the paid plan. Worse: Workers don't queue failed requests — the SR history that should grow is missing for those users, violating the PRD guardrail "review session must never lose progress." The fix is a Workers Queue + bulk-insert refactor, which pushes the team beyond MVP scope and into solving an infrastructure problem instead of shipping deck-sharing for v2.

### Unknown Unknowns

- **`compatibility_flags: ["nodejs_compat"]` ≠ "Node".** It's the ported subset of Node APIs. Specific `crypto`/`stream` methods may silently fall back or error in non-obvious ways. Supabase JS client mostly works, but verify the exact methods you call from server routes.
- **AGENTS.md note "`wrangler dev` differs from `astro dev`" is partly historical.** As of 2026 the Astro Cloudflare adapter runs `astro dev` on `workerd` via the Cloudflare Vite plugin — the fidelity gap narrowed sharply. But binding-heavy tests (KV/R2/D1) still want `wrangler dev`. Treating the AGENTS.md note as fully obsolete will miss bugs that only surface under workerd.
- **Workers have no local filesystem.** Anything in Astro that assumes `/tmp` (image optimization, file uploads) needs R2 or must be off-platform.
- **Cron Triggers are paid-tier only.** If FR-009's SR algorithm ever moves to a daily scheduled job ("compute next review batch"), that's a config and cost line you don't have today.
- **Cloudflare routes to nearest data center, not a specific region.** Irrelevant for Polish-only traffic latency-wise, but matters if compliance ever forces EU-only routing — regional control lives in higher tiers.

## Operational Story

- **Preview deploys**: Cloudflare Workers Builds creates a unique URL per branch push (`*.<project>.workers.dev`). For PRs from forks, the build runs in the upstream account; gate sensitive previews with Cloudflare Access if needed. The starter does not wire Workers Builds yet — for MVP the canonical local-then-deploy flow is `npm run build && npx wrangler deploy`; add Workers Builds later when GitHub PR previews become valuable.
- **Secrets**: live in Workers Secrets (`npx wrangler secret put SUPABASE_KEY`, etc.) for production. Local dev uses `.dev.vars` (already noted in `AGENTS.md`) — never `.env`. Secrets are write-only via CLI; values are not retrievable after set. Rotation = `wrangler secret put` overwrites; old value is discarded.
- **Rollback**: `npx wrangler rollback [VERSION_ID]` reverts the routing layer to a prior version in ~seconds. **Caveat**: the rolled-back version runs with _current_ secrets, not the secrets that existed at original deploy time. Database migrations do not roll back automatically — Supabase migrations are forward-only unless you wrote a down-migration.
- **Approval**: Human-only — first-time `wrangler login` OAuth flow, creating new Cloudflare API tokens, rotating the Supabase service key, rotating the OpenRouter API key, deleting the Worker, configuring custom domain DNS. Agent-allowed (with scoped token): `wrangler deploy`, `wrangler tail`, `wrangler secret put`, `wrangler rollback` between recent versions.
- **Logs**: `npx wrangler tail [--status error] [--search term] [--format json] [--sampling-rate 0.1]` for live streaming. Historical logs and analytics live in the Workers Observability dashboard; the `observability.mcp.cloudflare.com/mcp` MCP server exposes them to agents as structured tools rather than scraped text.

## Risk Register

| Risk                                                          | Source                        | Likelihood | Impact | Mitigation                                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU-time exhaustion during card extraction loop               | Devil's advocate / Pre-mortem | M          | H      | Upgrade to Workers Standard ($5/mo) from day one; batch Supabase inserts (one call per generation, not one per card); profile CPU on a 40-card paste before launch                          |
| Subrequest cap (50 free / 1,000 paid) breached on long pastes | Devil's advocate / Pre-mortem | M          | H      | Same as above — bulk Supabase insert collapses N writes to 1 subrequest; cap LLM-generated card count at a sane upper bound (e.g. 50)                                                       |
| `nodejs_compat` flag covers a subset of Node APIs only        | Unknown unknowns              | L          | M      | Smoke-test the Supabase client and any `crypto`/`stream` usage under `wrangler dev` (workerd) before each release; pin `compatibility_date` in `wrangler.jsonc` (already set to 2026-05-08) |
| `wrangler rollback` runs old code with new secrets            | Devil's advocate              | L          | M      | After a key rotation, re-deploy current code rather than rolling back; document this in runbook                                                                                             |
| Vendor lock-in via `_worker.js` + bindings                    | Devil's advocate              | L          | M      | Accept for MVP; revisit if multi-cloud becomes a requirement. Migration path is `@astrojs/node` + Dockerfile, not "drop binary elsewhere"                                                   |
| SR session loses progress under request failure               | Pre-mortem / PRD guardrail    | L          | H      | Wrap card-insert and review-write paths in idempotent retry; do not return success to the client until Supabase confirms; consider Workers Queue if failure rate exceeds 0.5%               |
| Astro Cloudflare adapter regression between releases          | Devil's advocate              | L          | M      | Pin `@astrojs/cloudflare` (already `^13.5.0`); subscribe to `withastro/adapters` releases; smoke-test deploy after every adapter bump                                                       |
| AGENTS.md drift on `astro dev` vs `wrangler dev`              | Unknown unknowns              | M          | L      | Update AGENTS.md to note: `astro dev` now runs on workerd; `wrangler dev` still preferred for binding-heavy tests                                                                           |
| No local FS inside Workers                                    | Unknown unknowns              | L          | L      | Not relevant for MVP scope (no image upload, no file processing); flag if scope expands                                                                                                     |
| Cron Triggers require paid tier                               | Unknown unknowns              | L          | L      | Not relevant for MVP (no scheduled jobs); flag if FR-009 scheduling moves server-side                                                                                                       |

## Getting Started

The project is already wired for Cloudflare Workers — `@astrojs/cloudflare` ^13.5.0, `wrangler` ^4.90.0, `wrangler.jsonc` with `nodejs_compat`, and the `ASSETS` binding are in place. These steps move from the current scaffolding to a live MVP deployment.

1. \*\*Authenticate
   ```
   npx wrangler login
   ```
2. **Set production secrets** (one-time, then on rotation):
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   npx wrangler secret put OPENROUTER_API_KEY
   ```
   Local dev uses `.dev.vars` (gitignored) — create one with the same keys for `npm run dev` and `npx wrangler dev`.
3. **First deploy**:
   ```
   npm run build
   npx wrangler deploy
   ```
   This bundles via `@astrojs/cloudflare`, uploads to `*.workers.dev`, and prints the live URL. Confirm the URL returns 200 before going further.
4. **Tail logs during smoke test**:
   ```
   npx wrangler tail --format pretty
   ```
   Run a paste-to-cards flow end-to-end and watch for `Exceeded CPU Time` or subrequest-cap errors. Profile here, not in production.

## Out of Scope

The following were not evaluated in this research:

- Dockerfile authoring (not needed on Workers).
- CI/CD pipeline setup (deferred to a later step — for MVP, manual `wrangler deploy` from `main` is acceptable).
- Production-scale architecture: Workers Queues, Durable Objects, multi-region failover, dedicated IP egress (relevant if scale forces a refactor; explicitly out of scope for the 3-week solo MVP).
