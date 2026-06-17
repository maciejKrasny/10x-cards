# 10x Cards

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

### Database migrations and types

The `cards` table and any future user-scoped schema lives under `supabase/migrations/`. Generated TypeScript types in `src/db/database.types.ts` are derived from the local stack and checked in.

After editing or adding a migration, run the four-step loop against a running local stack (`npx supabase start` must be up first):

```bash
npx supabase migration new <name>   # creates a timestamped .sql file
# edit the SQL
npx supabase db reset               # destructive: drops and recreates the local DB
npm run db:types                    # regenerates src/db/database.types.ts from the new schema
```

`supabase db reset` wipes all local data — anyone running it loses their seed inserts. Local codegen requires the reset first so the generated types reflect the latest migration.

The CI workflow re-runs `npm run db:types` and fails if the regenerated file would diff against what's checked in; run `npm run db:types && git add src/db/database.types.ts` after any migration change to keep CI green.

### RLS isolation test

`supabase/tests/rls_cards_isolation.sql` asserts that no user can see another user's cards (FR Guardrails-1). It inserts synthetic rows under two JWTs and asserts each user sees zero of the other's rows. Re-run it after any migration that touches RLS or adds a new user-scoped table.

```bash
npm run db:test:rls
```

The script exits non-zero (with a leak message) if any row crosses user boundaries. It cleans up its synthetic rows on success, so re-runs are idempotent.

To run the same script against the hosted DB after a migration touches RLS:

```bash
export HOSTED_DB_URL="postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres"   # from Supabase dashboard → Project Settings → Database → Connection string
npm run db:test:rls:linked
```

The `:linked` variant uses a transient `postgres:17-alpine` container (no local `psql` install required) and the same SQL file as the local variant — guaranteeing identical assertions on both environments. If you prefer not to manage `HOSTED_DB_URL` locally, run the script via the dashboard SQL editor instead (see `context/changes/deployment/runbook.md`).

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable             | Description                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`       | Project URL from Supabase dashboard → Settings → API                                                           |
| `SUPABASE_KEY`       | `anon` public key from Supabase dashboard → Settings → API                                                     |
| `OPENROUTER_API_KEY` | API key for [OpenRouter](https://openrouter.ai/) — used by the AI card-generation endpoint                     |
| `OPENROUTER_MODEL`   | OpenRouter model id, e.g. `openai/gpt-4o-mini` (default if unset); must support `response_format: json_schema` |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
OPENROUTER_API_KEY=<openrouter-key>
OPENROUTER_MODEL=openai/gpt-4o-mini
```

For production (Cloudflare Workers), set the OpenRouter values as secrets:

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENROUTER_MODEL
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

**Live URL**: https://10x-cards.maciej-krasny97.workers.dev

For the full runbook (secrets, rollback procedure, approval boundary, deferred items) see [`context/changes/deployment/runbook.md`](context/changes/deployment/runbook.md).

```bash
npm run build
npx wrangler deploy
```

## CI

GitHub Actions runs lint + build on every push and PR to `master`. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step.

## License

MIT
