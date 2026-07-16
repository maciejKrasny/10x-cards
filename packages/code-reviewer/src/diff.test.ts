import { describe, expect, it } from "vitest";
import { extractTouchedRanges, isExcluded, scopeDiff, splitDiffByFile } from "./diff.js";

function fileDiff(path: string, changes: number): string {
  const hunkLines: string[] = [];
  hunkLines.push(`diff --git a/${path} b/${path}`);
  hunkLines.push("index 0000000..1111111 100644");
  hunkLines.push(`--- a/${path}`);
  hunkLines.push(`+++ b/${path}`);
  hunkLines.push("@@ -1,0 +1," + String(changes) + " @@");
  for (let i = 0; i < changes; i += 1) {
    hunkLines.push("+line " + String(i));
  }
  return hunkLines.join("\n");
}

describe("isExcluded", () => {
  it("excludes package-lock.json", () => {
    expect(isExcluded("package-lock.json")).toBe(true);
  });

  it("excludes generated database types", () => {
    expect(isExcluded("src/db/database.types.ts")).toBe(true);
  });

  it("excludes anything under dist/", () => {
    expect(isExcluded("dist/index.js")).toBe(true);
    expect(isExcluded("dist/nested/file.ts")).toBe(true);
  });

  it("excludes anything under .astro/", () => {
    expect(isExcluded(".astro/types.d.ts")).toBe(true);
  });

  it("excludes minified assets", () => {
    expect(isExcluded("public/vendor.min.js")).toBe(true);
    expect(isExcluded("dist/app.min.css")).toBe(true);
  });

  it("excludes snapshot files", () => {
    expect(isExcluded("__snapshots__/foo.snap")).toBe(true);
    expect(isExcluded("tests/x.test.ts.snap")).toBe(true);
  });

  it("does not exclude normal source files", () => {
    expect(isExcluded("src/pages/index.astro")).toBe(false);
    expect(isExcluded("packages/code-reviewer/src/schema.ts")).toBe(false);
    expect(isExcluded("README.md")).toBe(false);
  });
});

describe("splitDiffByFile", () => {
  it("returns empty array for empty input", () => {
    expect(splitDiffByFile("")).toEqual([]);
  });

  it("splits multi-file diff on `diff --git` boundaries", () => {
    const raw = [fileDiff("a.ts", 3), fileDiff("b.ts", 2)].join("\n");
    const chunks = splitDiffByFile(raw);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.path).toBe("a.ts");
    expect(chunks[1]?.path).toBe("b.ts");
  });
});

describe("scopeDiff", () => {
  it("strips excluded paths and reports them as skipped", () => {
    const raw = [
      fileDiff("src/app.ts", 3),
      fileDiff("package-lock.json", 500),
      fileDiff("src/db/database.types.ts", 100),
    ].join("\n");
    const result = scopeDiff(raw, 3000);
    expect(result.reviewedFiles).toEqual(["src/app.ts"]);
    expect(result.skippedFiles).toEqual(["package-lock.json", "src/db/database.types.ts"]);
    expect(result.truncated).toBe(false);
  });

  it("truncates at file boundaries when the cap is exceeded", () => {
    const raw = [fileDiff("a.ts", 100), fileDiff("b.ts", 100), fileDiff("c.ts", 100)].join("\n");
    const result = scopeDiff(raw, 220);
    expect(result.reviewedFiles).toEqual(["a.ts", "b.ts"]);
    expect(result.skippedFiles).toEqual(["c.ts"]);
    expect(result.truncated).toBe(true);
    expect(result.diff.includes("a.ts")).toBe(true);
    expect(result.diff.includes("b.ts")).toBe(true);
    expect(result.diff.includes("c.ts")).toBe(false);
  });

  it("never truncates in the middle of a file", () => {
    const raw = fileDiff("big.ts", 500);
    const result = scopeDiff(raw, 100);
    expect(result.reviewedFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(["big.ts"]);
    expect(result.truncated).toBe(true);
    expect(result.diff).toBe("");
  });

  it("returns empty result for empty input without throwing", () => {
    const result = scopeDiff("", 3000);
    expect(result.reviewedFiles).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.diff).toBe("");
  });
});

describe("extractTouchedRanges", () => {
  it("returns an empty map for empty input", () => {
    expect(extractTouchedRanges("").size).toBe(0);
  });

  it("parses a standard @@ -a,b +c,d @@ hunk header", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -10,3 +12,5 @@",
      "+one",
    ].join("\n");
    const ranges = extractTouchedRanges(raw);
    expect(ranges.get("src/a.ts")).toEqual([[12, 16]]);
  });

  it("treats a hunk header with no length as length 1 (single-line hunk)", () => {
    const raw = [
      "diff --git a/src/b.ts b/src/b.ts",
      "@@ -5 +7 @@",
      "+one",
    ].join("\n");
    const ranges = extractTouchedRanges(raw);
    expect(ranges.get("src/b.ts")).toEqual([[7, 7]]);
  });

  it("collects multiple hunks per file", () => {
    const raw = [
      "diff --git a/src/c.ts b/src/c.ts",
      "@@ -1,2 +1,2 @@",
      "+one",
      "@@ -10,1 +20,3 @@",
      "+two",
    ].join("\n");
    const ranges = extractTouchedRanges(raw);
    expect(ranges.get("src/c.ts")).toEqual([[1, 2], [20, 22]]);
  });

  it("registers files with zero hunks (mode-only changes) as an empty array", () => {
    const raw = "diff --git a/src/d.ts b/src/d.ts\nold mode 100644\nnew mode 100755\n";
    const ranges = extractTouchedRanges(raw);
    expect(ranges.get("src/d.ts")).toEqual([]);
  });

  it("collects ranges across multiple files", () => {
    const raw = [
      "diff --git a/x.ts b/x.ts",
      "@@ -1,1 +1,1 @@",
      "+x",
      "diff --git a/y.ts b/y.ts",
      "@@ -1,1 +5,2 @@",
      "+y",
    ].join("\n");
    const ranges = extractTouchedRanges(raw);
    expect(ranges.get("x.ts")).toEqual([[1, 1]]);
    expect(ranges.get("y.ts")).toEqual([[5, 6]]);
  });
});
