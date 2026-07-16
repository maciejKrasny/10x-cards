import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  renderComment,
  renderUnavailableComment,
  verdictLabel,
  type CommentMeta,
} from "./comment.js";
import { CriterionName, type Review } from "./schema.js";

const META: CommentMeta = {
  timestamp: "2026-07-15T12:00:00Z",
  commitSha: "abc1234",
  model: "google/gemma-4-31b-it:free",
  reviewedFiles: ["src/a.ts", "src/b.ts"],
  skippedFiles: [],
  truncated: false,
};

function makeReview(verdict: "pass" | "fail"): Review {
  return {
    criteria: CriterionName.options.map((name) => ({ name, score: 8, rationale: "solid" })),
    overall: { verdict, summary: "looks good" },
    findings: [],
  };
}

describe("renderComment", () => {
  it("starts with the hidden HTML marker so retry logic can locate it", () => {
    const md = renderComment(makeReview("pass"), META);
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("shows a pass emoji + label when verdict is pass", () => {
    const md = renderComment(makeReview("pass"), META);
    expect(md.includes("✅")).toBe(true);
    expect(md.includes("Passed")).toBe(true);
  });

  it("shows a fail emoji + label when verdict is fail", () => {
    const md = renderComment(makeReview("fail"), META);
    expect(md.includes("❌")).toBe(true);
    expect(md.includes("Failed")).toBe(true);
  });

  it("renders every criterion in the table", () => {
    const md = renderComment(makeReview("pass"), META);
    for (const name of CriterionName.options) {
      expect(md.includes(name)).toBe(true);
    }
  });

  it("reports truncation and skipped files in the header when truncated", () => {
    const meta: CommentMeta = { ...META, truncated: true, skippedFiles: ["big.ts", "generated.js"] };
    const md = renderComment(makeReview("pass"), meta);
    expect(md.includes("truncated at diff-line budget")).toBe(true);
    expect(md.includes("big.ts")).toBe(true);
    expect(md.includes("generated.js")).toBe(true);
  });

  it("includes model, commit, and timestamp in the footer", () => {
    const md = renderComment(makeReview("pass"), META);
    expect(md.includes(META.model)).toBe(true);
    expect(md.includes(META.commitSha)).toBe(true);
    expect(md.includes(META.timestamp)).toBe(true);
  });

  it("escapes pipe characters and newlines in rationale cells", () => {
    const review = makeReview("pass");
    review.criteria[0] = {
      name: "implementation_correctness",
      score: 8,
      rationale: "handles a | b\nand line two",
    };
    const md = renderComment(review, META);
    expect(md.includes("a \\| b")).toBe(true);
    expect(md.includes("\nand line two")).toBe(false);
  });

  it("omits the Findings section entirely when findings is empty", () => {
    const md = renderComment(makeReview("pass"), META);
    expect(md.includes("### Findings")).toBe(false);
  });

  it("renders a Findings section beneath the summary with file:line, severity, description, and snippet", () => {
    const review = makeReview("fail");
    review.findings = [
      {
        file: "src/foo.ts",
        line: 42,
        snippet: "throw new Error(msg)",
        description: "swallows the original stack",
        severity: "warn",
      },
    ];
    const md = renderComment(review, META);
    const findingsIdx = md.indexOf("### Findings");
    const summaryIdx = md.indexOf("**Summary:**");
    const footerIdx = md.indexOf("_Model");
    expect(findingsIdx).toBeGreaterThan(summaryIdx);
    expect(findingsIdx).toBeLessThan(footerIdx);
    expect(md).toContain("**`src/foo.ts:42`**");
    expect(md).toContain("*(warn)*");
    expect(md).toContain("swallows the original stack");
    expect(md).toContain("throw new Error(msg)");
  });
});

describe("renderUnavailableComment", () => {
  it("includes the marker and the error code but no secrets", () => {
    const md = renderUnavailableComment("LLM_HTTP_ERROR", META);
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md.includes("LLM_HTTP_ERROR")).toBe(true);
    expect(md.includes("Unavailable")).toBe(true);
  });

  it("tells the user how to retry", () => {
    const md = renderUnavailableComment("LLM_INVALID_OUTPUT", META);
    expect(md.includes("ai-cr:review")).toBe(true);
  });
});

describe("verdictLabel", () => {
  it("maps pass to ai-cr:passed", () => {
    expect(verdictLabel("pass")).toBe("ai-cr:passed");
  });

  it("maps fail to ai-cr:failed", () => {
    expect(verdictLabel("fail")).toBe("ai-cr:failed");
  });
});
