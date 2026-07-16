import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/study/service", () => ({
  applyRating: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { applyRating } from "@/lib/study/service";
import { POST } from "@/pages/api/study/review";

const CARD_ID = "11111111-1111-4111-8111-111111111111";

function buildContext(body: unknown, rawBody = false): APIContext {
  const request = new Request("http://test/api/study/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody ? String(body) : JSON.stringify(body),
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

function fakeSupabase(userId: string | null = "user-A") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  };
}

function validPayload(overrides: Partial<{ card_id: string; rating: number; review_at: string }> = {}) {
  return {
    card_id: CARD_ID,
    rating: 3,
    review_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /api/study/review", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(createClient).mockReturnValue(fakeSupabase() as unknown as ReturnType<typeof createClient>);
    vi.mocked(applyRating).mockResolvedValue({ next: null, conflicted: false });
  });

  it("returns INVALID_REQUEST when body is not valid JSON", async () => {
    const response = await POST(buildContext("{", true));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns REVIEW_CONFLICT when review_at is outside accepted window", async () => {
    const tooOld = new Date(Date.now() - 120_000).toISOString();

    const response = await POST(buildContext(validPayload({ review_at: tooOld })));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("REVIEW_CONFLICT");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns SERVER_MISCONFIGURED when Supabase client is unavailable", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const response = await POST(buildContext(validPayload()));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("SERVER_MISCONFIGURED");
  });

  it("returns UNAUTHORIZED when user is not signed in", async () => {
    vi.mocked(createClient).mockReturnValue(fakeSupabase(null) as unknown as ReturnType<typeof createClient>);

    const response = await POST(buildContext(validPayload()));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns CARD_NOT_FOUND when service raises CARD_NOT_FOUND", async () => {
    vi.mocked(applyRating).mockRejectedValue(new Error("CARD_NOT_FOUND"));

    const response = await POST(buildContext(validPayload()));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("CARD_NOT_FOUND");
  });

  it("returns DB_QUERY_FAILED when service raises DB_QUERY_FAILED", async () => {
    vi.mocked(applyRating).mockRejectedValue(new Error("DB_QUERY_FAILED"));

    const response = await POST(buildContext(validPayload()));
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("DB_QUERY_FAILED");
  });

  it("returns 200 with review result payload on success", async () => {
    const now = new Date().toISOString();
    const previews: { rating: 1 | 2 | 3 | 4; due: string }[] = [
      { rating: 1, due: now },
      { rating: 2, due: now },
      { rating: 3, due: now },
      { rating: 4, due: now },
    ];

    const next = {
      id: CARD_ID,
      front: "Pytanie",
      back: "Odpowiedz",
      previews,
    };

    vi.mocked(applyRating).mockResolvedValue({ next, conflicted: true });

    const response = await POST(buildContext(validPayload()));
    const body = (await response.json()) as {
      ok: boolean;
      done: boolean;
      conflicted: boolean;
      next: typeof next | null;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.done).toBe(false);
    expect(body.conflicted).toBe(true);
    expect(body.next).toEqual(next);
  });
});
