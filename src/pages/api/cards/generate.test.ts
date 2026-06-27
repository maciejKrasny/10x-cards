import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_MODEL: "test-model",
  SUPABASE_URL: "test-url",
  SUPABASE_KEY: "test-key",
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { POST } from "@/pages/api/cards/generate";

const DECK_ID = "11111111-1111-4111-8111-111111111111";

function buildContext(body: unknown): APIContext {
  const request = new Request("http://test/api/cards/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    request,
    cookies: {
      get: () => undefined,
      set: () => undefined,
    },
    locals: {},
  } as unknown as APIContext;
}

function llmContent(cards: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ cards }) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function installFakeSupabase(): void {
  const fake = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-A" } }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: DECK_ID }, error: null }),
          })),
        })),
      })),
    })),
  };
  vi.mocked(createClient).mockReturnValue(fake as unknown as ReturnType<typeof createClient>);
}

describe("POST /api/cards/generate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFakeSupabase();
  });

  it("returns 200 with a non-empty cards array on a well-formed LLM response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(llmContent([{ front: "Q1", back: "A1" }]));

    const response = await POST(buildContext({ text: "study material", deck_id: DECK_ID }));
    const body = (await response.json()) as { ok: boolean; cards: unknown[] };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cards.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 502 LLM_FAILURE with no cards on a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const response = await POST(buildContext({ text: "study material", deck_id: DECK_ID }));
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("LLM_FAILURE");
    expect(body).not.toHaveProperty("cards");
  });

  it("returns 502 LLM_FAILURE with no cards on a non-OK upstream status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));

    const response = await POST(buildContext({ text: "study material", deck_id: DECK_ID }));
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("LLM_FAILURE");
    expect(body).not.toHaveProperty("cards");
  });

  it("returns 502 LLM_FAILURE with no cards on malformed JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json at all", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(buildContext({ text: "study material", deck_id: DECK_ID }));
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("LLM_FAILURE");
    expect(body).not.toHaveProperty("cards");
  });

  it("returns 502 LLM_FAILURE with no cards on a schema-violating empty array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(llmContent([]));

    const response = await POST(buildContext({ text: "study material", deck_id: DECK_ID }));
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("LLM_FAILURE");
    expect(body).not.toHaveProperty("cards");
  });

  it("returns 502 LLM_FAILURE with no cards on missing message content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(buildContext({ text: "study material", deck_id: DECK_ID }));
    const body = (await response.json()) as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("LLM_FAILURE");
    expect(body).not.toHaveProperty("cards");
  });
});
