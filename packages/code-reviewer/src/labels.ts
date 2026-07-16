import { LABEL_FAILED, LABEL_PASSED, verdictLabel, type VerdictLabel } from "./comment.js";
import type { Env } from "./env.js";

export const LABEL_RETRY = "ai-cr:review";

type Runner = (cmd: string, args: readonly string[]) => string;

export interface LabelDeps {
  stdout: (s: string) => void;
  runGh: Runner;
}

export function applyLabels(deps: LabelDeps, env: Env, verdictLbl: VerdictLabel): void {
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

export function removeRetryLabel(deps: LabelDeps, env: Env): void {
  const args = ["pr", "edit", env.prNumber, "--repo", env.repo, "--remove-label", LABEL_RETRY];
  if (env.dryRun) {
    deps.stdout(`[dry-run] gh ${args.join(" ")}\n`);
    return;
  }
  deps.runGh(args[0] ?? "pr", args.slice(1));
}

export { LABEL_FAILED, LABEL_PASSED, verdictLabel };
export type { VerdictLabel };
