#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { renderComment, renderUnavailableComment, type CommentMeta } from "./comment.js";
import { extractTouchedRanges, scopeDiff } from "./diff.js";
import { parseEnv, type Env } from "./env.js";
import { filterFindings } from "./findings.js";
import { fetchPRField, postComment } from "./gh.js";
import { applyLabels, cleanupOnUnavailable, verdictLabel } from "./labels.js";
import { createLogger, type Logger } from "./logger.js";
import { reviewPR } from "./review.js";
import { CriterionName } from "./schema.js";

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

  const logger = createLogger({
    level: env.logLevel,
    redact: [env.openrouterApiKey, env.ghToken],
    write: deps.stderr,
  });
  logger.info("env_parsed", {
    pr: env.prNumber,
    repo: env.repo,
    model: env.model,
    dry_run: env.dryRun,
    max_diff_lines: env.maxDiffLines,
    log_level: env.logLevel,
  });

  const ghDeps = { stdout: deps.stdout, runGh: deps.runGh, logger };
  const labelDeps = { stdout: deps.stdout, runGh: deps.runGh, logger };

  const title = env.dryRun ? "(dry-run) PR title" : fetchPRField(deps.runGh, env, "title");
  const body = env.dryRun ? "(dry-run) PR body" : fetchPRField(deps.runGh, env, "body");
  const commitSha = deps.runGit("rev-parse", ["--short", "HEAD"]).trim();

  const rawDiff = deps.runGit("diff", [`${env.baseRef}...${env.headRef}`]);
  const scoped = scopeDiff(rawDiff, env.maxDiffLines);
  const touchedRanges = extractTouchedRanges(scoped.diff);
  logger.info("diff_fetched", {
    reviewed_files: scoped.reviewedFiles.length,
    skipped_files: scoped.skippedFiles.length,
    truncated: scoped.truncated,
    diff_bytes: scoped.diff.length,
  });

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
      : await callReviewer(deps.reviewer, env, { title, description: body, scoped }, logger);
    const filteredFindings = filterFindings(review.findings, touchedRanges, {
      maxFindings: env.maxFindings,
      logger,
    });
    const reviewWithFindings = { ...review, findings: filteredFindings };
    logger.info("verdict_computed", {
      verdict: review.deterministicVerdict,
      summary_bytes: review.overall.summary.length,
      findings: filteredFindings.length,
    });
    const markdown = renderComment(reviewWithFindings, meta);
    postComment(ghDeps, env, markdown);
    applyLabels(labelDeps, env, verdictLabel(review.deterministicVerdict));
    return 0;
  } catch (err) {
    const code = extractErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    logger.error("reviewer_failed", { code, message });
    deps.stderr(`[ai-code-review] reviewer failed: ${message}\n`);
    const markdown = renderUnavailableComment(code, meta);
    postComment(ghDeps, env, markdown);
    cleanupOnUnavailable(labelDeps, env);
    return 0;
  }
}

async function callReviewer(
  reviewer: typeof reviewPR,
  env: Env,
  input: { title: string; description: string; scoped: ReturnType<typeof scopeDiff> },
  logger: Logger,
): Promise<Awaited<ReturnType<typeof reviewPR>>> {
  logger.group("AI review");
  const started = Date.now();
  logger.info("llm_call_started", { model: env.model });
  try {
    const { scoped } = input;
    const review = await reviewer(
      {
        title: input.title,
        description: input.description,
        diff: scoped.diff,
        truncationNote: scoped.truncated
          ? `Reviewed ${scoped.reviewedFiles.length.toString()} of ${(scoped.reviewedFiles.length + scoped.skippedFiles.length).toString()} files (truncated at ${env.maxDiffLines.toString()}-line budget).`
          : undefined,
      },
      { apiKey: env.openrouterApiKey, model: env.model },
    );
    logger.info("llm_call_finished", { duration_ms: Date.now() - started });
    return review;
  } finally {
    logger.endGroup();
  }
}

function synthesizeDryRunReview(): Awaited<ReturnType<typeof reviewPR>> {
  return {
    criteria: CriterionName.options.map((name) => ({ name, score: 8, rationale: "dry-run" })),
    overall: { verdict: "pass", summary: "dry-run synthetic review" },
    findings: [],
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
