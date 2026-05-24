# Cloudflare Workers — First Production Deployment

## Context

`context/foundation/infrastructure.md` (2026-05-23) selected **Cloudflare Workers** as the MVP deployment target. The repo is already scaffolded for it — `@astrojs/cloudflare` ^13.5.0, `wrangler` ^4.90.0, `wrangler.jsonc` with `nodejs_compat`, the `ASSETS` binding, and `observability.enabled: true`. Code is Workers-clean: no `fs`/`process.env`/`/tmp`/`setInterval`/hardcoded secrets (verified). The CI workflow lints + builds but does **not** deploy — by infrastructure.md decision, MVP uses manual `wrangler deploy` from `main`.

What's missing before a live URL exists:

1. Cloudflare account is on the **free tier**.
2. Supabase project exists but **auth is not configured for the production origin** — Site URL, redirect allowlist, Polish email templates, and a non-built-in SMTP provider all need wiring or auth will silently break on the live URL.
3. Worker name is still the starter default `10x-astro-starter` — rename to `10x-cards` before first deploy so the production hostname doesn't leak scaffolding origin.
4. Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`) have never been uploaded to Workers Secrets.
5. No rollback runbook exists yet, and `infrastructure.md` flagged a specific footgun: `wrangler rollback` runs old code with **current** secrets.

**Two deployment paths are required**, not one:

- **Manual** — `npx wrangler deploy` from a local checkout. Always available; used for the very first deploy, for hotfixes when Workers Builds is wedged, and for any deploy of an unmerged branch.
- **Automatic on push to master** — handled by **Cloudflare Workers Builds** (Cloudflare's native CI; explicitly _not_ GitHub Actions per the user's preference). Wired after the first manual deploy succeeds so the production URL and secrets already exist when the build pipeline first runs.

Outcome: a live `10x-cards.<account>.workers.dev` URL with end-to-end auth (signin → signup → email confirmation → protected `/dashboard`) verified, secrets in Workers Secrets, Workers Builds auto-deploying on push to `master`, a rollback procedure documented, and a runbook in the repo.

---

## Prerequisites

Complete these **before** starting Phase 0. They are one-time setup, require accounts/credentials that take time to obtain, and are not specific to this deployment — every Phase below assumes they're done.

### CLI tooling `[x]`

| Tool                | Required              | Verify with                            | If missing                                                                             |
| ------------------- | --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| **Node.js 22.14.0** | yes                   | `node -v` matches `.nvmrc`             | Using **Volta** on macOS — `volta install node@22.14.0` pins the version automatically |
| **npm**             | yes (bundled w/ Node) | `npm -v`                               | Reinstall Node                                                                         |
| **git**             | yes                   | `git --version`                        | macOS: `brew install git`                                                              |
| **wrangler**        | yes (via `npx`)       | `npx wrangler --version` reports `4.x` | Already in `devDependencies`; available after `npm install`                            |
| **gh (GitHub CLI)** | optional but useful   | `gh --version`                         | macOS: `brew install gh`; useful in Phase 8 to inspect Workers Builds status checks    |

Run from the repo root after cloning:

```
# Volta pins Node automatically via .nvmrc / package.json engines — just run:
npm install        # installs wrangler, astro, all deps; also wires Husky pre-commit
```

Husky's `prepare` script runs during `npm install` — pre-commit hooks (ESLint on `.ts/.tsx/.astro`, Prettier on `.json/.css/.md`) will fire on every commit from now on. Don't bypass with `--no-verify`; fix lint failures instead.

### Cloudflare account (free tier OK at this point — Phase 1 handles the upgrade) `[x]`

- [H] Create an account at https://dash.cloudflare.com/sign-up if you don't have one. Email verification is required and can take a few minutes.
- [H] Add a payment method under **Manage Account → Billing → Payment Methods**. The account stays on free tier until Phase 1 actively upgrades, but having the payment method on file avoids a context switch mid-deploy.
- [H] Note your **account subdomain** at the top-right of the dashboard — it's the `<account>` segment in `10x-cards.<account>.workers.dev` and the value you'll need when configuring the Supabase Site URL in Phase 3.

### Supabase account + production project `[x]`

This is the deeper prereq — region, key selection, and provider config all matter and are awkward to fix later.

- [H] Sign up at https://supabase.com/dashboard/sign-up. Email verification required.
- [H] **Create a new project** (Dashboard → New Project):
  - **Name**: `10x-cards-prod` (or similar — visible only to you).
  - **Region**: choose closest to your users. For Polish learners pick `eu-central-1` (Frankfurt). Region mismatch with Cloudflare's edge adds 50–150ms per Supabase round-trip; on a paste-to-cards flow that compounds across N inserts.
  - **Database password**: generate a strong one **and save to your password manager before clicking Create Project**. Supabase does not surface it again; you can reset it but not view it.
  - **Pricing plan**: Free tier is sufficient for MVP (500MB DB, 2GB bandwidth/mo, 50K MAU). Pro ($25/mo) becomes necessary only at real scale.
- [H] Wait ~2 minutes for the project to provision.
- [H] **Collect the two values consumed by this codebase** (project Dashboard → Project Settings → API):
  - `Project URL` → maps to **`SUPABASE_URL`**. Format: `https://<project-ref>.supabase.co`.
  - `Project API keys → anon public` → maps to **`SUPABASE_KEY`**.

  > ⚠️ **Use the `anon` public key, NOT the `service_role` key.** The `@supabase/ssr` pattern at `src/lib/supabase.ts:9` is built around the anon key combined with per-request user sessions (cookies) and Row Level Security. The `service_role` key bypasses RLS entirely — leaking it via a server route or accidental client-side reference would expose the entire database. If you're unsure which one you copied, the `service_role` key has `"role":"service_role"` in its JWT payload; the anon key has `"role":"anon"`.

- [H] **Authentication → Providers → Email**: confirm `Enable email provider` is ON. `Confirm email` should be ON for production (default). Phase 3 returns here to finalize the redirect URLs and email templates.
- [H] **Authentication → URL Configuration**: leave defaults for now — Site URL and Redirect URLs get filled in Phase 3 once the production Workers URL is known.
- [A] Create `.dev.vars` at the repo root (gitignored — `.gitignore:21`) so local `astro dev` / `wrangler dev` can talk to the same Supabase project the deployed Worker will use:
  ```
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon-public-key>
  ```
- [A] Smoke-test locally: `npm run dev`, open `http://localhost:4321`. The "Supabase nie jest skonfigurowany" warning banner (driven by `src/lib/config-status.ts:15-17`) should NOT appear. If it does, the env vars aren't loading — check `.dev.vars` is in repo root, not under `src/`.

### GitHub access (needed in Phase 8 — Workers Builds) `[x]`

- [H] Confirm you have **admin** rights on the `10x-cards` GitHub repository. Phase 8 installs the Cloudflare GitHub App, which requires admin permission to grant repo access.
- [H] If the repo lives in a GitHub organization (not under your personal account), confirm the org allows third-party OAuth/GitHub Apps: Org → Settings → Third-party Access → GitHub Apps → Allow installation.

### Password manager (have it ready) `[x]`

Five secrets land here before deployment is done; lose any of them and you're regenerating, not retrieving:

1. Cloudflare account credentials.
2. Cloudflare API token (created in Phase 1).
3. Supabase database password (created in this section — Supabase will never show it again).
4. Supabase anon public key (also lives in `.dev.vars` locally and Workers Secrets in prod, but keep a canonical copy here).
5. SMTP provider credentials (chosen in Phase 3 — Resend / SES / SendGrid).

---

## Phases

Each phase has a checkbox to mark when complete. Sub-bullets are individual steps; `[H]` marks human-only steps (interactive OAuth, billing UI, dashboard clicks), `[A]` marks agent-executable steps.

### Phase 0 — Pre-flight (read-only) `[ ]`

- [A] Re-read `context/foundation/infrastructure.md` and `context/foundation/lessons.md`.
- [A] Confirm working tree is clean (`git status`), on `main`/`master`.
- [A] Confirm `node -v` matches `.nvmrc` (`v22.14.0`).
- [A] Confirm `npm run build` succeeds locally before touching anything else — establishes a known-good baseline.

### Phase 1 — Cloudflare login `[ ]`

- [H] Run `wrangler login` and complete the OAuth flow in the browser.
- [H] Verify the session: `wrangler whoami`

### Phase 2 — Rename Worker + commit wrangler config change `[ ]`

- [A] Edit `wrangler.jsonc:3` — change `"name": "10x-astro-starter"` to `"name": "10x-cards"`.
- [A] Confirm no other file references the old name (`grep -r "10x-astro-starter"`). README/docs that mention it should be updated to `10x-cards` in the same commit.
- [A] Commit: `chore(deploy): rename worker to 10x-cards ahead of first production deploy`.

### Phase 3 — Supabase auth configuration for production `[x]`

This is the largest external-integration phase. Wrong values here cause silent failures (email links 404, signup looks successful but session never lands).

- [x] In the Supabase dashboard for the target project:
  - **Authentication → URL Configuration → Site URL**: set to `https://10x-cards.<account>.workers.dev` (substitute your account subdomain — you'll see it in the dashboard after first deploy if unknown; for now place a stub and revisit).
  - **Authentication → URL Configuration → Redirect URLs (allowlist)**: add `https://10x-cards.<account>.workers.dev/**`. Keep `http://localhost:4321/**` for local dev.
- [x] **Authentication → Email Templates**: kept default English templates (MVP decision — Polish UI convention applies to in-app text only).
- [x] **Authentication → SMTP Settings**: keeping built-in Supabase SMTP for MVP. Rate limit (~4 emails/hr) is acceptable at this scale; switch to Resend/SES/SendGrid if sign-up volume grows.
- [x] **Authentication → Providers → Email**: confirm `Confirm email` is **enabled** (it is by default). If disabled in dev, the `confirm-email.astro` branch logic at line 4 (`isAutoConfirmed = import.meta.env.DEV`) won't reach the production path.
- [A] **Document** the chosen SMTP provider + Site URL in `context/deployment/deploy-plan.md` once Phase 7 lands — Supabase doesn't surface "what SMTP did I configure" in a way the agent can re-derive later.

**Edge cases / extra support:**

- Site URL stub: until first deploy succeeds you won't know the exact `*.workers.dev` subdomain. Workaround: deploy once with auth misconfigured (Phase 5), read the URL from `wrangler deploy` output, **then** loop back here and set Site URL + redirect allowlist correctly **before** attempting any auth smoke test (Phase 6).
- If Supabase rejects the redirect URL pattern, prefer the trailing `/**` wildcard over listing every route individually — the auth API hits varying paths.
- SMTP "from" address must match a DNS-verified domain on most providers. Using a workers.dev URL as a "from" will get the mail filed as spam by Gmail.
- Email confirmation links in Supabase contain a token that expires in 24h by default. If testing across days, request a fresh confirmation rather than chasing "link expired" errors.

### Phase 4 — Local dev parity check `[x]`

- [x] Confirm `.dev.vars` exists at repo root with the same two keys (`SUPABASE_URL`, `SUPABASE_KEY`) pointing at the **cloud** Supabase project (not local Docker). If missing, copy `.env.example` to `.dev.vars` and fill in.
- [x] Confirm `.gitignore:21` covers `.dev.vars` (already does — verified).
- [x] Optional but recommended: add `.dev.vars.example` (copy of `.env.example`) so future agents see the Wrangler-native convention without having to read the README. One commit, no behavior change.
- [x] Run `npx wrangler dev` (Workers runtime under `workerd`) and exercise `/`, `/auth/signin`, `/auth/signup` once. All returned 200 — no `nodejs_compat` errors under workerd.

### Phase 5 — First production deploy `[ ]`

- [H] `npx wrangler login` — opens browser, OAuth flow against Cloudflare. Agent cannot do this; user must complete it. Token is stored in `~/.wrangler/config/default.toml`.
- [A] Set production secrets (each prompts for the value via stdin — paste, hit enter):
  ```
  npx wrangler secret put SUPABASE_URL
  npx wrangler secret put SUPABASE_KEY
  ```
  Values are write-only after submission. Lose them and you re-paste from the password manager; you can't retrieve them via CLI.
- [A] Build:
  ```
  npm run build
  ```
  Expected output: `dist/_worker.js` plus static assets in `dist/`. Wrangler `assets.directory: "./dist"` (`wrangler.jsonc:9`) picks these up.
- [A] Deploy:
  ```
  npx wrangler deploy
  ```
  Expected: a `Deployed 10x-cards triggers ... Current Version ID: <uuid>` line and a `https://10x-cards.<account>.workers.dev` URL. Record the URL and version ID — both are needed for Phase 6 and Phase 7.
- [A] **Loop back to Phase 3 now** with the real workers.dev URL to fix the Supabase Site URL + redirect allowlist stubs.

**Edge cases / extra support:**

- If `wrangler deploy` rejects `compatibility_date: 2026-05-08` as "in the future", bump to today's date in `wrangler.jsonc:5` and re-deploy. Cloudflare accepts dates ≤ today; the value pinned in repo is intentional but may need a one-line adjustment.
- If the deploy fails with "script exceeds 10 MB compressed", check `dist/_worker.js` size. The current scaffold ships well under, but adding heavy client libraries can push past it. Mitigation: move the offender to `public/` (served via `ASSETS`, not bundled into the worker).
- If `wrangler secret put` exits non-zero without explanation, verify `wrangler login` actually completed (no expired session). Re-run login if uncertain.
- If `_routes.json` is missing from `dist/` after build, `@astrojs/cloudflare` will generate one automatically — no manual action needed. Mentioning here only because absence used to be a deploy-time error.

### Phase 6 — Post-deploy smoke test `[ ]`

- [A] `npx wrangler tail --format pretty` in one terminal — leave it streaming.
- [A] In a browser (or curl), against the live URL:
  - [ ] `GET /` returns 200, renders the home page.
  - [ ] `GET /auth/signin` returns 200, form renders.
  - [ ] `GET /auth/signup` returns 200, form renders.
  - [ ] `POST /api/auth/signup` with a fresh email → redirects to `/auth/confirm-email` → confirmation email lands in inbox within 60s.
  - [ ] Clicking the confirmation link → lands on Site URL (must be the production URL, not `localhost`).
  - [ ] `POST /api/auth/signin` with that account → session cookie set → `GET /dashboard` returns 200.
  - [ ] Logged-out `GET /dashboard` redirects to `/auth/signin` (middleware: `src/middleware.ts:4,18-22`).
- [A] In the `wrangler tail` stream, watch for: `Exceeded CPU Time`, `Too many subrequests`, any uncaught exceptions. None should appear for the auth-only flows; if they do, the issue is in adapter or Supabase client config, not in user code.
- [A] Open Cloudflare dashboard → Workers → `10x-cards` → Observability. Verify the first invocations show up. CPU per request should be single-digit milliseconds for these auth flows.

**Edge cases / extra support:**

- If confirmation email never arrives: check Supabase Auth Logs (Dashboard → Logs → Auth). The most common cause is SMTP credentials misconfigured in Phase 3.
- If confirmation link 404s on the production URL: Site URL still points at `localhost` or the wrong subdomain. Return to Phase 3.
- If signin succeeds but `/dashboard` still redirects: cookie was set on the wrong domain (cookie domain mismatch). Inspect response cookies in DevTools — `Domain` attribute should match the workers.dev hostname.
- If `wrangler tail` shows no events even though requests are landing: re-check observability is enabled (`wrangler.jsonc:12-14`) and that the right worker name is being tailed.

### Phase 7 — Runbook + rollback documentation `[ ]`

- [A] Create `context/deployment/deploy-plan.md` containing:
  - Production URL.
  - Worker name and current version ID (from Phase 5 deploy output).
  - Active secrets (names only — never values).
  - Supabase project ID + Site URL + SMTP provider name (not credentials).
  - Rollback procedure (below).
  - Approval boundary copied from `infrastructure.md` "Operational Story" §Approval: human-only items vs agent-allowed items.
- [A] Document rollback explicitly with the footgun from `infrastructure.md` §Devil's Advocate #4:
  > `npx wrangler rollback [VERSION_ID]` reverts code in ~seconds **but runs against current secrets, not the secrets active at the original deploy time**. If you rolled secrets as part of an incident, re-deploy current code instead of rolling back, or you'll run old code with new keys.
- [A] List recent version IDs available for rollback: `npx wrangler deployments list`.
- [A] Update `README.md` Deployment section to point at `context/deployment/deploy-plan.md` for the live URL and runbook (avoid duplicating the URL in two files that will drift).

### Phase 8 — Wire Workers Builds for auto-deploy on push to master `[ ]`

Goal: every push to `master` triggers a Cloudflare-side build + deploy without leaving the dashboard, while preserving the ability to run `wrangler deploy` manually whenever needed.

- [H] In the Cloudflare dashboard: **Workers & Pages → 10x-cards → Settings → Builds → Connect**. Install the **Cloudflare GitHub App** on the `10x-cards` repository (or grant access to the org if it's not personal). This is a one-time GitHub OAuth + app-install flow; cannot be scripted.
- [H] In the Workers Builds UI, configure:
  - **Repository**: `10x-cards`.
  - **Production branch**: `master`. (Pushes to this branch deploy to the production URL `https://10x-cards.<account>.workers.dev`.)
  - **Preview branches**: _all non-production branches_. (Pushes to feature branches deploy to `https://<branch-slug>-10x-cards.<account>.workers.dev` — useful for PR review.)
  - **Build command**: `npm run build`
  - **Deploy command**: `npx wrangler deploy` (this is the default; confirm it's what's set).
  - **Root directory**: `/` (repo root — `wrangler.jsonc` lives here).
  - **Node version**: `22` (pin explicitly to match `.nvmrc:1` = `22.14.0`; Cloudflare Workers Builds default Node version is unknown — verify in the build UI and pin to `22` explicitly to prevent drift).
  - **Build environment variables**: add `SUPABASE_URL` and `SUPABASE_KEY` with the same values as Workers Secrets. These are needed by the _build container_, not by the deployed Worker. The runtime values still come from Workers Secrets set in Phase 5; this is a separate copy purely for `astro build` to read via `astro:env`. (The env schema at `astro.config.mjs:19-20` marks both `optional: true`, so the build _should_ succeed without them — but the existing `.github/workflows/ci.yml:24` passes them, so match that posture defensively.)
- [A] Push a trivial commit to `master` (e.g. add `.dev.vars.example` from Phase 4, or a comment-only README tweak): `git push origin master`.
- [A] Watch the build in the Cloudflare dashboard → Workers & Pages → 10x-cards → Deployments. The build log streams live. Expected: ~60–90s build, then a deploy log identical to the local `wrangler deploy` output. New version ID appears in `npx wrangler deployments list` once finished.
- [A] Repeat the Phase 6 smoke test against the production URL to confirm the auto-deployed version is healthy.
- [A] Open a throwaway feature branch, push, and confirm a preview URL appears in the dashboard (and in the GitHub PR's status checks, if the PR is opened). Delete the branch when done.

**Edge cases / extra support:**

- **Manual deploy + Workers Builds can race.** If you run `npx wrangler deploy` locally while a Workers Builds run is in flight, both produce a new version and the last one to finish wins. Mitigation: don't run manual deploys during/after a `git push` to master unless you intend to override; check the dashboard for an in-flight build first.
- **The existing `.github/workflows/ci.yml` keeps running on push.** It only lints + builds — it does not deploy — so it now overlaps with the Workers Builds build step (both will build the same commit). This is harmless duplication but burns CI minutes twice. Two options: (a) accept the duplication (recommended for MVP — GH Actions is the quality gate, Workers Builds is the deploy), or (b) narrow the GH Actions trigger to PRs only (`on: pull_request`) so push-to-master only triggers Workers Builds. Pick (a) for safety; flag (b) as a later optimization.
- **Workers Builds does _not_ gate on GitHub status checks.** A push to master with failing lint will still deploy via Workers Builds because Cloudflare doesn't wait for the GH Actions run. If you want a hard gate, configure GitHub branch protection on `master` requiring the CI check to pass before merge — which forces all changes to land via PR, not direct push.
- **PRs from forks build in the upstream account** per `infrastructure.md` §Operational Story. If sensitive routes are exposed in previews, gate them with Cloudflare Access before merging the first external PR.
- **Build container has no `.dev.vars` access.** It can read only the _Build environment variables_ configured above and any plaintext in the repo. Never commit secrets to fix a "missing env" build error — add them to the Workers Builds env vars UI.
- **First build may fail with "secrets schema requires SUPABASE_URL" even though the schema says `optional`.** This is an Astro 6 + `envField.secret` interaction edge: in some adapter versions the build validates `secret` access mode even when `optional`. Workaround if it bites: add both build env vars (per above), or temporarily drop `access: "secret"` → `access: "public"` for the build (don't ship that change; revert after diagnosing).
- **Rolling back an auto-deployed version uses the same `wrangler rollback [VERSION_ID]` from Phase 7.** Workers Builds doesn't add a separate rollback mechanism — version IDs are unified across manual and auto deploys.

### Phase 9 — Deferred (record-only, do not execute) `[ ]`

These remain out of scope for the MVP per `infrastructure.md` §Out of Scope. List them in `deploy-plan.md` as known follow-ups so they don't get re-discovered later:

- [ ] Custom domain (requires DNS migration, Cloudflare zone, cert provisioning).
- [ ] Cron Triggers (paid-tier only — now affordable since you're on Workers Standard — but not needed until FR-009 SR scheduling moves server-side).
- [ ] Workers Queues + bulk Supabase inserts (mitigation listed in `infrastructure.md` Risk Register row 1; defer until the LLM card-extraction route exists and shows real CPU/subrequest pressure).
- [ ] Narrowing `.github/workflows/ci.yml` to PR-only triggers once Workers Builds proves stable (removes the duplicate build on push to master; see Phase 8 edge cases).
- [ ] Cloudflare Access in front of preview URLs (required only if previews ever expose sensitive routes to fork PRs).

---

## External Integrations — At-a-Glance

| Integration                 | Touchpoint             | Phase          | Failure mode                                              | Recovery                                                       |
| --------------------------- | ---------------------- | -------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Cloudflare account          | Billing UI             | 1              | Free tier silently caps at 10ms CPU                       | Upgrade to Workers Standard before deploy                      |
| Cloudflare API token        | Dashboard token UI     | 1              | Over-scoped token = blast radius                          | Re-create with min scopes; revoke old                          |
| Wrangler OAuth              | Local browser          | 5              | Session expires; CLI errors are vague                     | Re-run `wrangler login`                                        |
| Supabase Site URL           | Auth → URL Config      | 3 + 5 loopback | Email links 404 on production                             | Update Site URL with real workers.dev origin                   |
| Supabase redirect allowlist | Auth → URL Config      | 3 + 5 loopback | "Invalid redirect URL" on signup                          | Add `https://<host>/**`                                        |
| Supabase SMTP               | Auth → SMTP            | 3              | Built-in SMTP throttles at ~4/hr                          | Configure Resend/SES/SendGrid + verified domain                |
| Supabase email templates    | Auth → Email Templates | 3              | English copy violates Polish-UI convention                | Replace four templates; keep `{{ .ConfirmationURL }}`          |
| Workers Secrets             | `wrangler secret put`  | 5              | Write-only after set; lost = re-paste                     | Keep secrets in password manager                               |
| GitHub ↔ Cloudflare app     | GitHub App install     | 8              | Org repo without admin can't install                      | Repo owner installs app, then connect                          |
| Workers Builds env vars     | Dashboard UI           | 8              | Build container can't read `.dev.vars` or Workers Secrets | Add `SUPABASE_URL`/`SUPABASE_KEY` as build env vars separately |

---

## Critical Files

- `wrangler.jsonc:3` — worker name rename (Phase 2).
- `wrangler.jsonc:5` — `compatibility_date` (touch only if Cloudflare rejects future-dated value).
- `astro.config.mjs:17-22` — env schema; no change needed, kept here as reference for which names Workers Secrets must match.
- `src/lib/supabase.ts:3,6` — env consumption point; will return `null` if Workers Secrets are missing in production (don't deploy without secrets).
- `src/middleware.ts:4,18-22` — protected routes list; verify `/dashboard` redirect works in Phase 6.
- `src/pages/api/auth/signup.ts:13,19` — uses default Supabase Site URL for email confirmation redirect; this is why Phase 3 Site URL config is load-bearing.
- `src/pages/auth/confirm-email.astro:4` — `import.meta.env.DEV` branch; production must reach the non-DEV copy.
- `.env.example` — production-secret name registry; `.dev.vars` must match exactly.
- `.github/workflows/ci.yml` — lint+build only, no deploy step (intentional per infrastructure.md).
- `README.md` Deployment section — update to point at `context/deployment/deploy-plan.md`.

---

## Verification (end-to-end test plan)

Run after Phase 6 completes:

1. **Build parity**: `npm run build` succeeds with zero new warnings vs the Phase 0 baseline.
2. **Wrangler-local parity**: `npx wrangler dev` serves `/`, `/auth/signin`, `/auth/signup` on `http://localhost:8787` without `nodejs_compat`-related console errors.
3. **Production smoke**: from a clean browser (incognito) against `https://10x-cards.<account>.workers.dev`, the full auth loop (signup → email confirm → signin → `/dashboard`) completes in under 90s end-to-end.
4. **Observability check**: Cloudflare dashboard → Workers → `10x-cards` → Observability shows the smoke-test invocations. CPU per request < 50ms for auth routes. Zero `Exceeded CPU Time` or `Too many subrequests` errors.
5. **Rollback dry-run**: `npx wrangler deployments list` returns at least one version; `npx wrangler rollback --dry-run <prev-version-id>` (if `--dry-run` is supported in the installed wrangler v4 — fall back to documenting only without executing if the flag is absent) confirms the version is rollback-eligible.
6. **Secret presence**: `npx wrangler secret list` shows `SUPABASE_URL` and `SUPABASE_KEY`. Values not retrievable — that's the desired posture.
7. **Repo state**: `context/deployment/deploy-plan.md` exists and includes URL, version ID, SMTP provider name, and rollback footgun note. README points at it. `wrangler.jsonc` shows `name: 10x-cards`. Commit history shows the rename + (if added) `.dev.vars.example` commits.
