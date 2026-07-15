import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock, createOpenRouterMock, MockNoObjectGeneratedError, outputObjectMock } = vi.hoisted(() => {
  class MockNoObjectGeneratedError extends Error {
    static isInstance(err: unknown): err is InstanceType<typeof MockNoObjectGeneratedError> {
      return err instanceof MockNoObjectGeneratedError;
    }
  }
  return {
    generateTextMock: vi.fn(),
    createOpenRouterMock: vi.fn(),
    outputObjectMock: vi.fn((spec: { schema: unknown }) => ({ __output: "object", schema: spec.schema })),
    MockNoObjectGeneratedError,
  };
});

vi.mock("ai", () => ({
  generateText: generateTextMock,
  NoObjectGeneratedError: MockNoObjectGeneratedError,
  Output: { object: outputObjectMock },
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
}));

import { reviewPR } from "./review.js";
import { CriterionName, type Review } from "./schema.js";

const OK_REVIEW: Review = {
  criteria: CriterionName.options.map((name) => ({ name, score: 8, rationale: "solid" })),
  overall: { verdict: "pass", summary: "looks good" },
};

const FAILING_REVIEW: Review = {
  criteria: CriterionName.options.map((name) => ({ name, score: 3, rationale: "weak" })),
  overall: { verdict: "pass", summary: "model thinks it's fine" },
};

const PROMPT_INPUT = { title: "t", description: "d", diff: "x" };

describe("reviewPR", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    createOpenRouterMock.mockReset();
    createOpenRouterMock.mockReturnValue({ chat: () => ({ tag: "model" }) });
  });

  it("throws LLM_NOT_CONFIGURED when apiKey is empty", async () => {
    await expect(reviewPR(PROMPT_INPUT, { apiKey: "", model: "m" })).rejects.toThrow("LLM_NOT_CONFIGURED");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns the review plus deterministic verdict on success", async () => {
    generateTextMock.mockResolvedValueOnce({ output: OK_REVIEW });
    const result = await reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" });
    expect(result.criteria).toEqual(OK_REVIEW.criteria);
    expect(result.overall.verdict).toBe("pass");
    expect(result.deterministicVerdict).toBe("pass");
  });

  it("overrides the model verdict with the deterministic rule when they disagree", async () => {
    generateTextMock.mockResolvedValueOnce({ output: FAILING_REVIEW });
    const result = await reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" });
    expect(result.overall.verdict).toBe("pass");
    expect(result.deterministicVerdict).toBe("fail");
  });

  it("throws LLM_INVALID_OUTPUT when the SDK reports NoObjectGeneratedError", async () => {
    generateTextMock.mockRejectedValueOnce(new MockNoObjectGeneratedError("schema mismatch"));
    await expect(reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" })).rejects.toThrow("LLM_INVALID_OUTPUT");
  });

  it("wraps arbitrary errors as LLM_HTTP_ERROR with truncated upstream message", async () => {
    const long = "network hiccup ".repeat(50);
    generateTextMock.mockRejectedValueOnce(new Error(long));
    await expect(reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" })).rejects.toThrow(/^LLM_HTTP_ERROR: /);
  });

  it("truncates upstream error bodies to 240 chars", async () => {
    const long = "e".repeat(1000);
    generateTextMock.mockRejectedValueOnce(new Error(long));
    try {
      await reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" });
      throw new Error("expected rejection");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const suffix = msg.replace(/^LLM_HTTP_ERROR: /, "");
      expect(suffix.length).toBeLessThanOrEqual(240);
    }
  });

  it("does not include the API key in any thrown error message", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("boom"));
    try {
      await reviewPR(PROMPT_INPUT, { apiKey: "super-secret-key", model: "m" });
      throw new Error("expected rejection");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg.includes("super-secret-key")).toBe(false);
    }
  });

  it("maps 'no completion'-style messages to LLM_EMPTY_RESPONSE", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("upstream returned no completion"));
    await expect(reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" })).rejects.toThrow(/^LLM_EMPTY_RESPONSE: /);
  });

  it("throws LLM_INVALID_OUTPUT when the model returns wrong criteria count", async () => {
    const shortReview: Review = {
      criteria: OK_REVIEW.criteria.slice(0, 3),
      overall: { verdict: "pass", summary: "partial" },
    };
    generateTextMock.mockResolvedValueOnce({ output: shortReview });
    await expect(reviewPR(PROMPT_INPUT, { apiKey: "k", model: "m" })).rejects.toThrow(/^LLM_INVALID_OUTPUT:/);
  });
});
