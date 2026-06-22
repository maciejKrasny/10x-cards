import { describe, it, expect } from "vitest";
import { GeneratedCardsSchema } from "@/lib/llm/schemas";

describe("GeneratedCardsSchema", () => {
  it("accepts a single valid card", () => {
    const result = GeneratedCardsSchema.safeParse([{ front: "Q", back: "A" }]);
    expect(result.success).toBe(true);
  });

  it("accepts the maximum of 30 cards", () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({
      front: `Q${i}`,
      back: `A${i}`,
    }));
    const result = GeneratedCardsSchema.safeParse(cards);
    expect(result.success).toBe(true);
  });

  it("rejects an empty array", () => {
    const result = GeneratedCardsSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects more than 30 cards", () => {
    const cards = Array.from({ length: 31 }, (_, i) => ({
      front: `Q${i}`,
      back: `A${i}`,
    }));
    const result = GeneratedCardsSchema.safeParse(cards);
    expect(result.success).toBe(false);
  });

  it("rejects a card with an empty front", () => {
    const result = GeneratedCardsSchema.safeParse([{ front: "", back: "A" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a card with a front over 1000 characters", () => {
    const result = GeneratedCardsSchema.safeParse([{ front: "a".repeat(1001), back: "A" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a card missing the back field", () => {
    const result = GeneratedCardsSchema.safeParse([{ front: "Q" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a non-string back field", () => {
    const result = GeneratedCardsSchema.safeParse([{ front: "Q", back: 42 }]);
    expect(result.success).toBe(false);
  });
});
