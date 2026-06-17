# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
npm run dev          # start Astro dev server
npm run build        # production build (outputs to /dist)
npm run preview      # preview the production build locally
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format all files
```

Deployment uses Wrangler (Cloudflare Workers):

```bash
npx wrangler deploy  # deploy to Cloudflare
npx wrangler dev     # local Cloudflare Workers runtime (differs from astro dev)
```

## Architecture

**Runtime**: Astro v6 SSR on Cloudflare Workers. Every page is server-rendered at the edge; client JS is minimal — only React components that need interactivity are hydrated.

**Auth**: Supabase Auth only (no custom DB schema). The `middleware.ts` runs on every request, extracts the session, injects `context.locals.user`, and redirects unauthenticated users away from `PROTECTED_ROUTES`. To protect a new route, add its path to that array.

**Supabase client**: Created in `src/lib/supabase.ts`. Returns `null` if env vars are missing — code must guard against this. Credentials are server-only (`astro:env/server`) and never reach the browser.

**LLM client**: `src/lib/llm/openrouter.ts` wraps OpenRouter's chat-completions endpoint with strict `json_schema` response format. Reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`) from `astro:env/server`. Errors throw `Error` with stable code messages (`LLM_HTTP_ERROR`, `LLM_EMPTY_RESPONSE`, `LLM_INVALID_OUTPUT`, `LLM_NOT_CONFIGURED`) and never leak request/response strings.

**Routing**:

- `src/pages/api/auth/` — POST-only form handlers (signin, signup, signout); form-encoded in, redirect out
- `src/pages/api/cards/` — JSON-in / JSON-out endpoints; must call `supabase.auth.getUser()` for auth (middleware does not redirect API routes)
- `src/middleware.ts` — session extraction and route protection (pages only)

**Components**: `.astro` files for layout/structure, `.tsx` React files for interactive UI. Shadcn-style component registry configured (`components.json`) — add new primitives to `src/components/ui/`.

**Path alias**: see `@tsconfig.json`.

## Key conventions

- `cn()` from `src/lib/utils.ts` is the single utility for merging Tailwind classes (clsx + tailwind-merge).
- Error/warning UI in `src/components/Banner.astro` is driven by `src/lib/config-status.ts`; extend that file to surface new configuration problems.
- Node version is pinned to v22.14.0 (`.nvmrc`). Use `nvm use` before installing deps.
- Pre-commit hooks (Husky + lint-staged) run ESLint on `.ts/.tsx/.astro` and Prettier on `.json/.css/.md`. Commits will fail if lint errors exist.
- UI text/error messages in this project use Polish.

## Recurring rules

See @context/foundation/lessons.md for project-specific rules captured from past work. Re-read before planning or implementing.

## Environment setup

For Supabase and Cloudflare local dev setup, see @README.md. Wrangler local dev requires `.dev.vars`, not `.env`.

Env vars (all server-only, declared in `astro.config.mjs`):

- `SUPABASE_URL`, `SUPABASE_KEY` — Supabase project + `anon` key
- `OPENROUTER_API_KEY` — OpenRouter API key for AI card generation
- `OPENROUTER_MODEL` — OpenRouter model id (default `openai/gpt-4o-mini`)
