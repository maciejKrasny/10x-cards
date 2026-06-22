---
change_id: testing-generation-flow-contract
title: Generation-flow contract — LLM payload robustness + env-var rollout gate
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Generation-flow contract".
Risks covered: #1 (LLM provider returns invalid/corrupted payload — generation flow saves garbage or crashes) and #2 (production env-var rollout gap — new secret in code but not in Workers Secrets → 502 on first prod request).
Test types planned: unit (LLM-response schema parser), integration (api/cards/generate.ts against mocked LLM fixtures: happy / malformed JSON / schema-violating JSON / empty array / network error), and a CI gate that prevents shipping a new secret without it being set in Workers Secrets.

Risk response intent (from test-plan.md §2 Risk Response Guidance):
- Risk #1: prove that a malformed/truncated/empty LLM response is rejected with a clean user-visible error and ZERO cards persisted, while the happy path still produces ≥1 valid card. Anti-pattern: oracle problem — do not derive expected output by reading the parser; derive it from the card contract.
- Risk #2: prove that a deploy introducing a new secret cannot ship without that secret being set in Workers Secrets — caught by a structural CI gate (Progress checkbox enforced) or a pre-deploy probe of the new endpoint. Anti-pattern: treating prose in plan.md as a gate.

Phase 1 also bootstraps the JS/TS test runner (likely Vitest given Astro 6 + Vite 7) and the API-edge HTTP mocking layer — these become the foundation §3 Phases 2–4 build on.

After creating the folder, follow the downstream continuation rule: suggest the next natural command (/10x-research with a risks-to-verify brief that grounds Risk #1 and Risk #2 in current code) unless there is a clear blocker.
