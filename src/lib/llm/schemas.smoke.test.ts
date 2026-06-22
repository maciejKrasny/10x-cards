import { describe, it, expect } from "vitest";
import { GeneratedCardsSchema } from "@/lib/llm/schemas";

describe("Vitest smoke test", () => {
  it("parses a known-good payload via the @/* alias", () => {
    const result = GeneratedCardsSchema.safeParse([{ front: "Q", back: "A" }]);
    expect(result.success).toBe(true);
  });
});
