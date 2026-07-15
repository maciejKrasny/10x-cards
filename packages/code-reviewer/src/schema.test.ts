import { describe, expect, it } from "vitest";
import { computeVerdict, CriterionName, reviewSchema, type Criterion } from "./schema.js";

function makeCriterion(name: CriterionName, score: number): Criterion {
  return { name, score, rationale: "ok" };
}

function makePassing(): Criterion[] {
  return CriterionName.options.map((n) => makeCriterion(n, 8));
}

describe("reviewSchema", () => {
  it("accepts a well-formed review with all six criteria", () => {
    const review = {
      criteria: makePassing(),
      overall: { verdict: "pass" as const, summary: "looks good" },
    };
    expect(reviewSchema.safeParse(review).success).toBe(true);
  });

  it("rejects fewer than six criteria", () => {
    const review = {
      criteria: makePassing().slice(0, 5),
      overall: { verdict: "pass" as const, summary: "ok" },
    };
    expect(reviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects more than six criteria", () => {
    const review = {
      criteria: [...makePassing(), makeCriterion("implementation_correctness", 8)],
      overall: { verdict: "pass" as const, summary: "ok" },
    };
    expect(reviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects non-integer scores", () => {
    const criteria = makePassing();
    criteria[0] = { name: "implementation_correctness", score: 7.5, rationale: "ok" };
    const review = { criteria, overall: { verdict: "pass" as const, summary: "ok" } };
    expect(reviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects scores outside 1–10", () => {
    for (const badScore of [0, 11, -1]) {
      const criteria = makePassing();
      criteria[0] = { name: "implementation_correctness", score: badScore, rationale: "ok" };
      const review = { criteria, overall: { verdict: "pass" as const, summary: "ok" } };
      expect(reviewSchema.safeParse(review).success).toBe(false);
    }
  });

  it("rejects missing overall verdict", () => {
    const review = { criteria: makePassing(), overall: { summary: "ok" } };
    expect(reviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects invalid verdict enum", () => {
    const review = {
      criteria: makePassing(),
      overall: { verdict: "maybe", summary: "ok" },
    };
    expect(reviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects empty rationale", () => {
    const criteria = makePassing();
    criteria[0] = { name: "implementation_correctness", score: 8, rationale: "" };
    const review = { criteria, overall: { verdict: "pass" as const, summary: "ok" } };
    expect(reviewSchema.safeParse(review).success).toBe(false);
  });
});

describe("computeVerdict", () => {
  it("returns fail on empty input", () => {
    expect(computeVerdict([])).toBe("fail");
  });

  it("returns fail when any score is ≤ 4", () => {
    const criteria = makePassing();
    criteria[2] = { name: "complexity", score: 4, rationale: "borderline" };
    expect(computeVerdict(criteria)).toBe("fail");
  });

  it("returns fail when mean < 7 even if all scores > 4", () => {
    const criteria = CriterionName.options.map((n) => makeCriterion(n, 6));
    expect(computeVerdict(criteria)).toBe("fail");
  });

  it("returns pass when all scores > 4 and mean ≥ 7", () => {
    const criteria = CriterionName.options.map((n) => makeCriterion(n, 7));
    expect(computeVerdict(criteria)).toBe("pass");
  });

  it("returns pass at the exact boundary (min > 4, mean = 7)", () => {
    const criteria: Criterion[] = [
      makeCriterion("implementation_correctness", 5),
      makeCriterion("idiomaticity", 6),
      makeCriterion("complexity", 7),
      makeCriterion("test_risk_coverage", 8),
      makeCriterion("documentation", 8),
      makeCriterion("security_and_safety", 8),
    ];
    expect(computeVerdict(criteria)).toBe("pass");
  });
});
