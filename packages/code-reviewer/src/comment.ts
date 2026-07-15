import type { Review, Verdict } from "./schema.js";

export const COMMENT_MARKER = "<!-- ai-code-review:v1 -->";

export interface CommentMeta {
  timestamp: string;
  commitSha: string;
  model: string;
  reviewedFiles: string[];
  skippedFiles: string[];
  truncated: boolean;
}

export function renderComment(review: Review, meta: CommentMeta): string {
  const verdict = review.overall.verdict;
  const emoji = verdict === "pass" ? "✅" : "❌";
  const label = verdict === "pass" ? "Passed" : "Failed";

  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push(`## ${emoji} AI Code Review — ${label}`);
  lines.push("");
  lines.push(renderTruncationHeader(meta));
  lines.push("");
  lines.push("| Criterion | Score | Rationale |");
  lines.push("| --- | ---: | --- |");
  for (const c of review.criteria) {
    lines.push(`| ${c.name} | ${String(c.score)} / 10 | ${escapeTableCell(c.rationale)} |`);
  }
  lines.push("");
  lines.push("**Summary:** " + review.overall.summary);
  lines.push("");
  lines.push(renderFooter(meta));
  return lines.join("\n");
}

export function renderUnavailableComment(errorCode: string, meta: CommentMeta): string {
  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push("## ⚠️ AI Code Review — Unavailable");
  lines.push("");
  lines.push(`The reviewer could not complete this run. Error code: \`${errorCode}\`.`);
  lines.push("No verdict label was applied. Add the \`ai-cr:review\` label to retry.");
  lines.push("");
  lines.push(renderFooter(meta));
  return lines.join("\n");
}

function renderTruncationHeader(meta: CommentMeta): string {
  const total = meta.reviewedFiles.length + meta.skippedFiles.length;
  if (!meta.truncated) {
    return `Reviewed ${String(meta.reviewedFiles.length)} of ${String(total)} files.`;
  }
  const skipped = meta.skippedFiles.length === 0 ? "(none)" : meta.skippedFiles.map((f) => "`" + f + "`").join(", ");
  return [
    `Reviewed ${String(meta.reviewedFiles.length)} of ${String(total)} files (truncated at diff-line budget).`,
    `Skipped: ${skipped}`,
  ].join("\n");
}

function renderFooter(meta: CommentMeta): string {
  return `_Model \`${meta.model}\` · commit \`${meta.commitSha}\` · run \`${meta.timestamp}\`_`;
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function verdictLabel(verdict: Verdict): string {
  return verdict === "pass" ? "ai-cr:passed" : "ai-cr:failed";
}
