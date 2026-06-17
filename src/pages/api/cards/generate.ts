import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { generateCardsFromText } from "@/lib/llm/openrouter";
import { GenerateRequestSchema } from "@/lib/llm/schemas";
import { errorResponse, classifyZodError } from "@/lib/api/errors";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("INVALID_REQUEST");
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(classifyZodError(parsed.error, ["text"]));
  }
  const { text, deck_id } = parsed.data;

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

  // Deck-ownership check kept even though this endpoint no longer writes:
  // it validates the deck_id the client will pass to /api/cards/bulk after
  // review, and 404s early so the user isn't shown a review list for a deck
  // that will fail at submit. 404 (not 403) avoids confirming existence.
  const { data: deck } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deck_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!deck) {
    return errorResponse("DECK_NOT_FOUND");
  }

  let generated;
  try {
    generated = await generateCardsFromText(text);
  } catch {
    return errorResponse("LLM_FAILURE");
  }

  return new Response(JSON.stringify({ ok: true, cards: generated }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
