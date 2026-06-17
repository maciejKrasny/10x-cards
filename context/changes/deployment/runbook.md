# 10x Cards — Production Runbook

## Live environment

| Key                    | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| **Production URL**     | https://10x-cards.maciej-krasny97.workers.dev                  |
| **Worker name**        | `10x-cards`                                                    |
| **Current version ID** | `034a1bcd-4c01-45d1-a403-f61f53adc958`                         |
| **Cloudflare account** | maciej.krasny97@gmail.com (`bd0cee5cf6e9933c450eb5dc6a7dcb62`) |
| **KV Namespace**       | `10x-cards-session` (`f38da7f0f79a4e7d8b082ae419f82465`)       |

## Active secrets (names only)

- `SUPABASE_URL`
- `SUPABASE_KEY`

Values are write-only via CLI. Retrieve from password manager; rotate with `npx wrangler secret put <NAME>`.

## Supabase project

| Key                    | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| **Project URL**        | https://adtjatwwrarnbsbiexul.supabase.co                                       |
| **Site URL**           | https://10x-cards.maciej-krasny97.workers.dev                                  |
| **Redirect allowlist** | `https://10x-cards.maciej-krasny97.workers.dev/**`, `http://localhost:4321/**` |
| **SMTP provider**      | Built-in Supabase SMTP (MVP — rate-limited to ~4 emails/hr)                    |
| **Email templates**    | Default English                                                                |

## Deploy

```bash
npm run build
npx wrangler deploy
```

## Rollback

```bash
npx wrangler deployments list          # find a prior version ID
npx wrangler rollback <VERSION_ID>     # reverts routing in ~seconds
```

> **Footgun**: `wrangler rollback` runs the old code with **current** secrets. If you rotated a secret as part of an incident, re-deploy current code instead of rolling back — otherwise old code runs with new keys.

## Approval boundary

**Human-only** (cannot be delegated to agent):

- First-time `wrangler login` OAuth flow
- Creating or revoking Cloudflare API tokens
- Rotating Supabase service key or OpenRouter API key
- Deleting the Worker
- Configuring custom domain DNS

**Agent-allowed** (with active wrangler session):

- `npx wrangler deploy`
- `npx wrangler tail`
- `npx wrangler secret put`
- `npx wrangler rollback` between recent versions
- `npx wrangler deployments list`

## Log streaming

```bash
npx wrangler tail --format pretty
npx wrangler tail --status error         # errors only
npx wrangler tail --format json          # structured output
```

Historical logs and analytics: Cloudflare dashboard → Workers → `10x-cards` → Observability.

## Database migrations

Migrations live in `supabase/migrations/` and are versioned by CLI-generated timestamps. The linked hosted project is `adtjatwwrarnbsbiexul` (see Supabase project section above).

Apply a new migration to the hosted DB:

```bash
npx supabase link --project-ref adtjatwwrarnbsbiexul   # one-time per workstation
npx supabase db push                                   # applies pending local migrations
npm run db:types                                       # regenerate src/db/database.types.ts
```

Manually review the diff in the push prompt before confirming. Push is human-gated; not automated from CI.

After any RLS change or new user-scoped table, re-run the isolation test against hosted. Two equivalent paths:

- **From the CLI** (preferred for scripted runs): `export HOSTED_DB_URL="..."` (Supabase dashboard → Project Settings → Database → Connection string, direct connection), then `npm run db:test:rls:linked`. Uses a transient `postgres:17-alpine` container; no local `psql` install required.
- **From the dashboard SQL editor** (https://supabase.com/dashboard/project/adtjatwwrarnbsbiexul/sql), pasting the contents of `supabase/tests/rls_cards_isolation.sql`.

Either path inserts synthetic rows, asserts cross-user invisibility, and cleans up after itself — no manual row deletion needed.

## Deferred (post-MVP)

- Custom domain (requires DNS migration + Cloudflare zone)
- Cron Triggers (paid-tier; needed only if FR-009 SR scheduling moves server-side)
- Workers Queues + bulk Supabase inserts (if LLM card-extraction route shows CPU/subrequest pressure)
- Narrow `.github/workflows/ci.yml` to PR-only once Workers Builds is stable
- Cloudflare Access in front of preview URLs (needed only if forks expose sensitive routes)
