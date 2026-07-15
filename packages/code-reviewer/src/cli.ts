#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scopeDiff } from "./diff.js";
import {
  LABEL_FAILED,
  LABEL_PASSED,
  renderComment,
  renderUnavailableComment,
  verdictLabel,
  type CommentMeta,
  type VerdictLabel,
} from "./comment.js";
import { reviewPR } from "./review.js";
import { CriterionName } from "./schema.js";

const REQUIRED_ENV = [
  "GITHUB_REPOSITORY",
  "PR_NUMBER",
  "BASE_REF",
  "HEAD_REF",
  "OPENROUTER_API_KEY",
  "AI_CR_MODEL",
] as const;

const LABEL_RETRY = "ai-cr:review";
const DEFAULT_MAX_DIFF_LINES = 3000;

interface Env {
  ghToken: string;
  repo: string;
  prNumber: string;
  baseRef: string;
  headRef: string;
  openrouterApiKey: string;
  model: string;
  dryRun: boolean;
  maxDiffLines: number;
}

type Runner = (cmd: string, args: readonly string[]) => string;

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  runGit: Runner;
  runGh: Runner;
  reviewer: typeof reviewPR;
  now: () => string;
}

export async function runCli(deps: CliDeps): Promise<number> {
  const env = parseEnv(deps.env, deps.stderr);
  if (env === null) return 2;

  const title = env.dryRun ? "(dry-run) PR title" : fetchPRField(deps.runGh, env, "title");
  const body = env.dryRun ? "(dry-run) PR body" : fetchPRField(deps.runGh, env, "body");
  const commitSha = deps.runGit("rev-parse", ["--short", "HEAD"]).trim();

  const rawDiff = deps.runGit("diff", [`${env.baseRef}...${env.headRef}`]);
  const scoped = scopeDiff(rawDiff, env.maxDiffLines);

  const meta: CommentMeta = {
    timestamp: deps.now(),
    commitSha,
    model: env.model,
    reviewedFiles: scoped.reviewedFiles,
    skippedFiles: scoped.skippedFiles,
    truncated: scoped.truncated,
  };

  try {
    const review = env.dryRun
      ? synthesizeDryRunReview()
      : await deps.reviewer(
          {
            title,
            description: body,
            diff: scoped.diff,
            truncationNote: scoped.truncated
              ? `Reviewed ${scoped.reviewedFiles.length.toString()} of ${(scoped.reviewedFiles.length + scoped.skippedFiles.length).toString()} files (truncated at ${env.maxDiffLines.toString()}-line budget).`
              : undefined,
          },
          { apiKey: env.openrouterApiKey, model: env.model },
        );
    const markdown = renderComment(review, meta);
    postComment(deps, env, markdown);
    applyLabels(deps, env, verdictLabel(review.deterministicVerdict));
    return 0;
  } catch (err) {
    const code = extractErrorCode(err);
    deps.stderr(`[ai-code-review] reviewer failed: ${err instanceof Error ? err.message : String(err)}\n`);
    const markdown = renderUnavailableComment(code, meta);
    postComment(deps, env, markdown);
    removeRetryLabel(deps, env);
    return 0;
  }
}

function parseEnv(source: NodeJS.ProcessEnv, stderr: (s: string) => void): Env | null {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV) {
    if (!source[key] || source[key]?.length === 0) missing.push(key);
  }
  const ghToken = source.GH_TOKEN ?? source.GITHUB_TOKEN ?? "";
  if (ghToken.length === 0) missing.push("GH_TOKEN or GITHUB_TOKEN");
  if (missing.length > 0) {
    stderr(`Missing required environment variable(s): ${missing.join(", ")}\n`);
    return null;
  }
  const maxLinesRaw = source.AI_CR_MAX_DIFF_LINES;
  const maxDiffLines =
    maxLinesRaw !== undefined && maxLinesRaw.length > 0 ? Number.parseInt(maxLinesRaw, 10) : DEFAULT_MAX_DIFF_LINES;
  return {
    ghToken,
    repo: source.GITHUB_REPOSITORY ?? "",
    prNumber: source.PR_NUMBER ?? "",
    baseRef: source.BASE_REF ?? "",
    headRef: source.HEAD_REF ?? "",
    openrouterApiKey: source.OPENROUTER_API_KEY ?? "",
    model: source.AI_CR_MODEL ?? "",
    dryRun: source.AI_CR_DRY_RUN === "1",
    maxDiffLines: Number.isFinite(maxDiffLines) && maxDiffLines > 0 ? maxDiffLines : DEFAULT_MAX_DIFF_LINES,
  };
}

function fetchPRField(runGh: Runner, env: Env, field: "title" | "body"): string {
  const out = runGh("pr", ["view", env.prNumber, "--repo", env.repo, "--json", field, "--jq", `.${field}`]);
  return out.trim();
}

function postComment(deps: CliDeps, env: Env, markdown: string): void {
  if (env.dryRun) {
    deps.stdout(`[dry-run] gh pr comment ${env.prNumber} --repo ${env.repo} --body-file <tempfile>\n`);
    deps.stdout("--- comment body ---\n");
    deps.stdout(markdown);
    deps.stdout("\n--- end body ---\n");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "ai-cr-"));
  const path = join(dir, "comment.md");
  writeFileSync(path, markdown, "utf8");
  deps.runGh("pr", ["comment", env.prNumber, "--repo", env.repo, "--body-file", path]);
}

function applyLabels(deps: CliDeps, env: Env, verdictLbl: VerdictLabel): void {
  const opposite: VerdictLabel = verdictLbl === LABEL_PASSED ? LABEL_FAILED : LABEL_PASSED;
  const args = [
    "pr",
    "edit",
    env.prNumber,
    "--repo",
    env.repo,
    "--add-label",
    verdictLbl,
    "--remove-label",
    opposite,
    "--remove-label",
    LABEL_RETRY,
  ];
  if (env.dryRun) {
    deps.stdout(`[dry-run] gh ${args.join(" ")}\n`);
    return;
  }
  deps.runGh(args[0] ?? "pr", args.slice(1));
}

function removeRetryLabel(deps: CliDeps, env: Env): void {
  const args = ["pr", "edit", env.prNumber, "--repo", env.repo, "--remove-label", LABEL_RETRY];
  if (env.dryRun) {
    deps.stdout(`[dry-run] gh ${args.join(" ")}\n`);
    return;
  }
  deps.runGh(args[0] ?? "pr", args.slice(1));
}

function synthesizeDryRunReview(): Awaited<ReturnType<typeof reviewPR>> {
  return {
    criteria: CriterionName.options.map((name) => ({ name, score: 8, rationale: "dry-run" })),
    overall: { verdict: "pass", summary: "dry-run synthetic review" },
    deterministicVerdict: "pass",
  };
}

function extractErrorCode(err: unknown): string {
  if (!(err instanceof Error)) return "LLM_HTTP_ERROR";
  const match = /^([A-Z][A-Z0-9_]*)/.exec(err.message);
  return match?.[1] ?? "LLM_HTTP_ERROR";
}

function defaultRunner(cmd: string, args: readonly string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function main(): Promise<void> {
  const code = await runCli({
    env: process.env,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    runGit: (subcmd, args) => defaultRunner("git", [subcmd, ...args]),
    runGh: (subcmd, args) => defaultRunner("gh", [subcmd, ...args]),
    reviewer: reviewPR,
    now: () => new Date().toISOString(),
  });
  process.exit(code);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main();
}
