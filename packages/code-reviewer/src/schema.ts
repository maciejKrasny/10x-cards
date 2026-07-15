import { z } from "zod";

export const CriterionName = z.enum([
  "implementation_correctness",
  "idiomaticity",
  "complexity",
  "test_risk_coverage",
  "documentation",
  "security_and_safety",
]);
export type CriterionName = z.infer<typeof CriterionName>;

export const CriterionSchema = z.object({
  name: CriterionName,
  score: z.number().int().min(1).max(10),
  rationale: z.string().min(1).max(500),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const OverallSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string().min(1).max(1000),
});
export type Overall = z.infer<typeof OverallSchema>;

export const EXPECTED_CRITERIA_COUNT = 6;

export const reviewSchema = z.object({
  criteria: z.array(CriterionSchema).min(1),
  overall: OverallSchema,
});
export type Review = z.infer<typeof reviewSchema>;

export type Verdict = "pass" | "fail";

const MIN_SCORE_THRESHOLD = 4;
const MEAN_SCORE_THRESHOLD = 7;

export function computeVerdict(criteria: readonly Criterion[]): Verdict {
  if (criteria.length === 0) return "fail";
  const scores = criteria.map((c) => c.score);
  const minScore = Math.min(...scores);
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  if (minScore <= MIN_SCORE_THRESHOLD) return "fail";
  if (mean < MEAN_SCORE_THRESHOLD) return "fail";
  return "pass";
}
