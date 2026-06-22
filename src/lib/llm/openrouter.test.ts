import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_MODEL: "test-model",
  SUPABASE_URL: "test-url",
  SUPABASE_KEY: "test-key",
}));

import { generateCardsFromText } from "@/lib/llm/openrouter";

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function llmResponse(cards: unknown): Response {
  return okJson({
    choices: [{ message: { content: JSON.stringify({ cards }) } }],
  });
}

describe("generateCardsFromText", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed cards on a well-formed OpenRouter response", async () => {
    const cards = [{ front: "Q1", back: "A1" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(llmResponse(cards));

    const result = await generateCardsFromText("study material");

    expect(result).toEqual(cards);
  });

  it("throws LLM_NOT_CONFIGURED when OPENROUTER_API_KEY is missing", async () => {
    vi.resetModules();
    vi.doMock("astro:env/server", () => ({
      OPENROUTER_API_KEY: undefined,
      OPENROUTER_MODEL: "test-model",
      SUPABASE_URL: "test-url",
      SUPABASE_KEY: "test-key",
    }));

    const { generateCardsFromText: gen } = await import("@/lib/llm/openrouter");
    await expect(gen("study material")).rejects.toThrow("LLM_NOT_CONFIGURED");

    vi.doUnmock("astro:env/server");
  });

  it("throws LLM_HTTP_ERROR when fetch itself rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(generateCardsFromText("study material")).rejects.toThrow("LLM_HTTP_ERROR");
  });

  it("throws LLM_HTTP_ERROR on non-OK response status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(generateCardsFromText("study material")).rejects.toThrow("LLM_HTTP_ERROR");
  });

  it("throws LLM_INVALID_OUTPUT when response body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json at all", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(generateCardsFromText("study material")).rejects.toThrow("LLM_INVALID_OUTPUT");
  });

  it("throws LLM_EMPTY_RESPONSE when message content is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ choices: [] }));

    await expect(generateCardsFromText("study material")).rejects.toThrow("LLM_EMPTY_RESPONSE");
  });

  it("throws LLM_INVALID_OUTPUT when message content is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ choices: [{ message: { content: "not json" } }] }));

    await expect(generateCardsFromText("study material")).rejects.toThrow("LLM_INVALID_OUTPUT");
  });

  it("throws LLM_INVALID_OUTPUT when cards array fails schema validation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(llmResponse([]));

    await expect(generateCardsFromText("study material")).rejects.toThrow("LLM_INVALID_OUTPUT");
  });
});
