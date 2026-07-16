import { describe, expect, it } from "vitest";
import { filterFindings } from "./findings.js";
import { createLogger } from "./logger.js";
import type { Finding, Severity } from "./schema.js";

function makeLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  return { logger: createLogger({ level: "debug", write: (line) => lines.push(line) }), lines };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/a.ts",
    line: 5,
    snippet: "let x = 1",
    description: "d",
    severity: "info",
    ...overrides,
  };
}

const RANGES = new Map<string, Array<[number, number]>>([
  ["src/a.ts", [[1, 10]]],
  ["src/b.ts", [[20, 30], [50, 60]]],
]);

describe("filterFindings — validation", () => {
  it("drops findings whose file is not in the touched map and logs finding_dropped_unknown_file", () => {
    const { logger, lines } = makeLogger();
    const kept = filterFindings(
      [makeFinding({ file: "src/unknown.ts", line: 3 })],
      RANGES,
      { maxFindings: 10, logger },
    );
    expect(kept).toEqual([]);
    expect(lines.join("")).toContain("event=finding_dropped_unknown_file");
    expect(lines.join("")).toContain("file=src/unknown.ts");
  });

  it("drops findings whose line falls outside every range and logs finding_dropped_out_of_hunk", () => {
    const { logger, lines } = makeLogger();
    const kept = filterFindings(
      [makeFinding({ file: "src/b.ts", line: 40 })],
      RANGES,
      { maxFindings: 10, logger },
    );
    expect(kept).toEqual([]);
    expect(lines.join("")).toContain("event=finding_dropped_out_of_hunk");
    expect(lines.join("")).toContain("line=40");
  });

  it("keeps findings whose line is inside any range for that file", () => {
    const { logger } = makeLogger();
    const kept = filterFindings(
      [
        makeFinding({ file: "src/b.ts", line: 25 }),
        makeFinding({ file: "src/b.ts", line: 55 }),
      ],
      RANGES,
      { maxFindings: 10, logger },
    );
    expect(kept).toHaveLength(2);
  });
});

describe("filterFindings — sort order", () => {
  it("orders by severity desc (blocker > warn > info), then file asc, then line asc", () => {
    const { logger } = makeLogger();
    const findings: Finding[] = [
      makeFinding({ file: "src/b.ts", line: 25, severity: "info" }),
      makeFinding({ file: "src/a.ts", line: 5, severity: "blocker" }),
      makeFinding({ file: "src/a.ts", line: 3, severity: "warn" }),
      makeFinding({ file: "src/a.ts", line: 7, severity: "warn" }),
      makeFinding({ file: "src/b.ts", line: 22, severity: "blocker" }),
    ];
    const kept = filterFindings(findings, RANGES, { maxFindings: 10, logger });
    const trace = kept.map((f) => `${f.severity}:${f.file}:${String(f.line)}`);
    expect(trace).toEqual([
      "blocker:src/a.ts:5",
      "blocker:src/b.ts:22",
      "warn:src/a.ts:3",
      "warn:src/a.ts:7",
      "info:src/b.ts:25",
    ]);
  });
});

describe("filterFindings — cap", () => {
  it("caps the kept list at maxFindings and logs findings_capped with total + kept", () => {
    const { logger, lines } = makeLogger();
    const findings: Finding[] = [];
    for (const line of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const severity: Severity = "info";
      findings.push(makeFinding({ file: "src/a.ts", line, severity }));
    }
    const kept = filterFindings(findings, RANGES, { maxFindings: 3, logger });
    expect(kept).toHaveLength(3);
    const log = lines.join("");
    expect(log).toContain("event=findings_capped");
    expect(log).toContain("total=8");
    expect(log).toContain("kept=3");
  });

  it("does not log findings_capped when the list is at or below the cap", () => {
    const { logger, lines } = makeLogger();
    const kept = filterFindings([makeFinding()], RANGES, { maxFindings: 10, logger });
    expect(kept).toHaveLength(1);
    expect(lines.join("")).not.toContain("event=findings_capped");
  });
});
