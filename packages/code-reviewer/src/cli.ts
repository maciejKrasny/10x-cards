#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { renderComment, renderUnavailableComment, type CommentMeta } from "./comment.js";
import { scopeDiff } from "./diff.js";
import { parseEnv } from "./env.js";
import { fetchPRField, postComment } from "./gh.js";
import { applyLabels, removeRetryLabel, verdictLabel } from "./labels.js";
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
