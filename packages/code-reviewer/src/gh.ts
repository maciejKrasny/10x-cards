import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Env } from "./env.js";

type Runner = (cmd: string, args: readonly string[]) => string;

export interface GhDeps {
  stdout: (s: string) => void;
  runGh: Runner;
}

export function fetchPRField(runGh: Runner, env: Env, field: "title" | "body"): string {
  const out = runGh("pr", ["view", env.prNumber, "--repo", env.repo, "--json", field, "--jq", `.${field}`]);
  return out.trim();
}

export function postComment(deps: GhDeps, env: Env, markdown: string): void {
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
