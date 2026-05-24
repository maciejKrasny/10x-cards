---
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
---

## Why this stack

10x Astro Starter bundles the full feature surface 10xCards needs out of the box: Supabase handles email/password auth and a PostgreSQL-backed deck and review-history store, Astro 6 + React 19 provide the interactive study UI with TypeScript end-to-end, and Cloudflare Pages delivers zero-config edge deployment within the starter's first-class scaffolding confidence. The 3-week after-hours timeline favors the starter's opinionated defaults — no assembly required for auth, DB, or deploy. The one integration not bundled is the LLM call for card generation (FR-004); that wires in as a server-side Astro API route calling an external AI service (e.g., Anthropic), which sits cleanly within the starter's architecture and is unblocked by the edge runtime as long as the call is treated as a short-lived fetch rather than a long-running held-open stream.
