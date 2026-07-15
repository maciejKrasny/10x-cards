---
change_id: ci-cd-code-reviewer
title: CI/CD AI code reviewer in packages/code-reviewer
status: implementing
created: 2026-07-15
updated: 2026-07-15
archived_at: null
---

## Notes

Introduce a dedicated CI/CD Code Reviewer package located at packages/code-reviewer. The package will use the AI SDK to perform automated code review analysis and produce a structured, standardized output.

The review should evaluate predefined quality areas, assign scores based on configurable parameters, and generate a concise summary of the proposed changes. This standardized output will serve as an input for subsequent AI-driven workflow steps, ensuring consistent and reliable downstream processing.