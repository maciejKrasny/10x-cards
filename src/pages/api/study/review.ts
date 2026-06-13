import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { errorResponse, classifyZodError, type ErrorCode } from "@/lib/api/errors";
import { ReviewRequestSchema, withinReviewWindow } from "@/lib/study/schemas";
import { applyRating } from "@/lib/study/service";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("INVALID_REQUEST");
  }

  const parsed = ReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(classifyZodError(parsed.error, ["card_id", "rating", "review_at"]));
  }
  const input = parsed.data;

  if (!withinReviewWindow(input.review_at)) {
    return errorResponse("REVIEW_CONFLICT");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errorResponse("SERVER_MISCONFIGURED");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse("UNAUTHORIZED");
  }

  try {
    const result = await applyRating(supabase, user.id, input);
    return new Response(JSON.stringify({ ok: true, next: result.next, done: result.next === null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(serviceErrorToCode(err));
  }
};

function serviceErrorToCode(err: unknown): ErrorCode {
  const message = err instanceof Error ? err.message : "";
  switch (message) {
    case "CARD_NOT_FOUND":
      return "CARD_NOT_FOUND";
    case "DB_QUERY_FAILED":
      return "DB_QUERY_FAILED";
    case "DB_UPDATE_FAILED":
      return "DB_UPDATE_FAILED";
    default:
      return "DB_UPDATE_FAILED";
  }
}
