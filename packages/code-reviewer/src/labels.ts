import { LABEL_FAILED, LABEL_PASSED, verdictLabel, type VerdictLabel } from "./comment.js";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";

export const LABEL_RETRY = "ai-cr:review";

type Runner = (cmd: string, args: readonly string[]) => string;

export interface LabelDeps {
  stdout: (s: string) => void;
  runGh: Runner;
  logger: Logger;
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
    deps.logger.info("labels_applied", { pr: env.prNumber, added: verdictLbl, removed: `${opposite},${LABEL_RETRY}`, dry_run: true });
    return;
  }
  deps.runGh(args[0] ?? "pr", args.slice(1));
  deps.logger.info("labels_applied", { pr: env.prNumber, added: verdictLbl, removed: `${opposite},${LABEL_RETRY}` });
}

export function cleanupOnUnavailable(deps: LabelDeps, env: Env): void {
  const removed = `${LABEL_RETRY},${LABEL_PASSED},${LABEL_FAILED}`;
  const args = [
    "pr",
    "edit",
    env.prNumber,
    "--repo",
    env.repo,
    "--remove-label",
    LABEL_RETRY,
    "--remove-label",
    LABEL_PASSED,
    "--remove-label",
    LABEL_FAILED,
  ];
  if (env.dryRun) {
    deps.stdout(`[dry-run] gh ${args.join(" ")}\n`);
    deps.logger.warn("labels_cleaned_on_unavailable", { pr: env.prNumber, removed, dry_run: true });
    return;
  }
  deps.runGh(args[0] ?? "pr", args.slice(1));
  deps.logger.warn("labels_cleaned_on_unavailable", { pr: env.prNumber, removed });
}

export { LABEL_FAILED, LABEL_PASSED, verdictLabel };
export type { VerdictLabel };
