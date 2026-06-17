---
bootstrapped_at: 2026-05-23T13:28:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10x-cards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-cards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

10x Astro Starter bundles the full feature surface 10xCards needs out of the box: Supabase handles email/password auth and a PostgreSQL-backed deck and review-history store, Astro 6 + React 19 provide the interactive study UI with TypeScript end-to-end, and Cloudflare Pages delivers zero-config edge deployment within the starter's first-class scaffolding confidence. The 3-week after-hours timeline favors the starter's opinionated defaults — no assembly required for auth, DB, or deploy. The one integration not bundled is the LLM call for card generation (FR-004); that wires in as a server-side Astro API route calling an external AI service (e.g., Anthropic), which sits cleanly within the starter's architecture and is unblocked by the edge runtime as long as the call is treated as a short-lived fetch rather than a long-running held-open stream.

## Pre-scaffold verification

| Signal      | Value   | Severity | Notes                                                                                                    |
| ----------- | ------- | -------- | -------------------------------------------------------------------------------------------------------- |
| npm package | not run | n/a      | cmd_template starts with `git clone`; npm package recency check skipped per pre-scaffold-verification.md |
| GitHub repo | not run | n/a      | `gh api` returned 404 — gh CLI appears configured for GitHub Enterprise; public repo check unavailable   |

Recency check unavailable: `gh` CLI is configured for GitHub Enterprise Server (api returned 404 for `przeprogramowani/10x-astro-starter`). The repo cloned successfully via HTTPS, indicating it is publicly accessible on github.com. Proceeding.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: clone the starter repo without keeping its git history (git-clone)
**Exit code**: 0
**Files moved**: all top-level entries from `.bootstrap-scaffold/` (`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md` → `CLAUDE.md.scaffold` (existing `CLAUDE.md` from bootstrap chain preserved)
**.gitignore handling**: moved silently (no `.gitignore` existed in cwd prior to scaffold)
**.bootstrap-scaffold cleanup**: deleted

npm engine warnings (informational, not blocking):

- Node v20.19.5 in use; several packages require `>=22.0.0` or `>=22.12.0`. The starter card's toolchain specifies `node 22`. Upgrading to Node 22 LTS is recommended before running `npm run dev` or deploying.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0 direct HIGH/CRITICAL of total 0/1; 2 direct MODERATE (`@astrojs/check`, `wrangler`) of 9 total MODERATE

#### HIGH findings

- **devalue** v5.6.3–5.8.0 (transitive)
  - Advisory: GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization"
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - CWE: CWE-770 (Allocation of Resources Without Limits or Throttling)
  - Fix available: yes (`npm audit fix` can address this)
  - Path: transitive (not a direct dependency)

#### MODERATE findings

1. **@astrojs/check** >=0.9.3 (direct) — via `@astrojs/language-server` → `volar-service-yaml`. Fix: downgrade to `@astrojs/check@0.9.2` (semver major break).
2. **@astrojs/language-server** >=2.14.0 (transitive) — via `volar-service-yaml`.
3. **@cloudflare/vite-plugin** (transitive) — via `miniflare`, `wrangler`, `ws`.
4. **miniflare** (transitive) — via `ws` (uninitialized memory disclosure).
5. **volar-service-yaml** <=0.0.70 (transitive) — via `yaml-language-server`.
6. **wrangler** 3.108.0–4.93.0 (direct) — via `miniflare`.
7. **ws** 8.0.0–8.20.0 (transitive) — GHSA-58qx-3vcg-4xpx, uninitialized memory disclosure, CVSS 4.4. Fix: `npm audit fix`.
8. **yaml** 2.0.0–2.8.2 (transitive) — GHSA-48c2-rrv3-qjmp, stack overflow via deeply nested YAML, CVSS 4.3.
9. **yaml-language-server** (transitive) — via `yaml`.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | false                |

These values were read from the hand-off and preserved here for the future M1L4 skill (Memory Architecture). No automated action was taken on any of them in v1.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` — the starter ships its own CLAUDE.md; diff it against your existing one to see if anything is worth merging in.
- Upgrade to Node 22 LTS (`nvm install 22 && nvm use 22`) — several packages (astro, wrangler, miniflare) require it.
- Run `npm audit fix` to address the HIGH `devalue` finding and several MODERATE ones.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
