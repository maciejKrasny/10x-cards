import { CriterionName } from "./schema.js";

const RUBRIC_LINES = [
  "You are a strict senior code reviewer.",
  "Score the pull request against exactly the six criteria named below on a 1–10 scale, where 1 is the worst outcome and 10 is the best.",
  "Return one score, one short rationale (<= 500 chars), and one overall summary (<= 1000 chars). Do not add criteria beyond the six listed. Do not omit any.",
  "",
  "Criteria (use these names verbatim):",
  "1) implementation_correctness — Does the code actually do what the PR claims, handling stated inputs, edge cases, and failure modes without introducing regressions?",
  "   1: broken or wrong — fails the stated intent, mishandles obvious inputs, or breaks existing behavior.",
  "   10: provably correct — intent is met end-to-end, edge cases and failure modes are handled deliberately.",
  "2) idiomaticity — Does the change follow the language, framework, and repository conventions a fluent reader of this codebase would expect?",
  "   1: alien to the codebase — ignores established patterns, reinvents built-ins, or fights the framework.",
  "   10: reads like the rest of the repo — a maintainer would have written it the same way.",
  "3) complexity — Is the change as simple as it can be for what it delivers, without unnecessary abstraction, indirection, or scope creep?",
  "   1: over-engineered or tangled — abstractions, layers, or scope that the task does not justify.",
  "   10: minimal and direct — every line earns its place; nothing simpler would still work.",
  "4) test_risk_coverage — Are the behaviors and failure modes introduced or touched by this change verified in proportion to their risk?",
  "   1: untested where it matters — risky logic ships with no meaningful verification.",
  "   10: risk-proportionate coverage — critical paths and failure modes have targeted, trustworthy tests.",
  "5) documentation — Are the non-obvious 'whys,' public interfaces, and operational concerns explained where a future reader will actually look?",
  "   1: opaque — non-obvious decisions, interfaces, or ops concerns left unexplained.",
  "   10: self-explanatory — the 'why,' public surface, and operational notes are captured where readers will find them.",
  "6) security_and_safety — Does the change avoid introducing vulnerabilities, unsafe data handling, or unsafe operational behaviors given its blast radius?",
  "   1: unsafe — introduces a vulnerability, leaks sensitive data, or performs a destructive action without safeguards.",
  "   10: defense-in-depth — inputs, secrets, permissions, and side effects are handled safely for the change's blast radius.",
  "",
  "Set `overall.verdict` to your best judgment ('pass' or 'fail'), but note that the caller computes the authoritative verdict deterministically from the scores.",
  "Keep rationales concrete. Reference specific files or hunks when useful. Do not restate the diff.",
].join("\n");

export interface PromptInput {
  title: string;
  description: string;
  diff: string;
  truncationNote?: string;
}

export interface Prompt {
  system: string;
  prompt: string;
}

export function buildPrompt(input: PromptInput): Prompt {
  const parts: string[] = [];
  parts.push(`PR title: ${input.title}`);
  parts.push("");
  parts.push("PR description:");
  parts.push(input.description.length > 0 ? input.description : "(no description provided)");
  parts.push("");
  if (input.truncationNote !== undefined && input.truncationNote.length > 0) {
    parts.push(`Note: ${input.truncationNote}`);
    parts.push("");
  }
  parts.push("---DIFF---");
  parts.push(input.diff);
  return { system: RUBRIC_LINES, prompt: parts.join("\n") };
}

export const CRITERION_NAMES_IN_PROMPT: readonly string[] = CriterionName.options;
