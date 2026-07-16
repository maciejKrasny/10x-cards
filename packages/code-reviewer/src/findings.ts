import type { Logger } from "./logger.js";
import type { Finding, Severity } from "./schema.js";

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, warn: 1, info: 2 };

export interface FilterFindingsOptions {
  maxFindings: number;
  logger: Logger;
}

export function filterFindings(
  raw: readonly Finding[],
  touched: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>,
  opts: FilterFindingsOptions,
): Finding[] {
  const kept: Finding[] = [];
  for (const finding of raw) {
    const ranges = touched.get(finding.file);
    if (ranges === undefined) {
      opts.logger.warn("finding_dropped_unknown_file", { file: finding.file, line: finding.line });
      continue;
    }
    if (!inAnyRange(finding.line, ranges)) {
      opts.logger.warn("finding_dropped_out_of_hunk", { file: finding.file, line: finding.line });
      continue;
    }
    kept.push(finding);
  }

  kept.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });

  if (kept.length > opts.maxFindings) {
    opts.logger.info("findings_capped", { total: kept.length, kept: opts.maxFindings });
    return kept.slice(0, opts.maxFindings);
  }
  return kept;
}

function inAnyRange(line: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (line >= start && line <= end) return true;
  }
  return false;
}
