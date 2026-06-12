import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { generateCardsFromText } from "@/lib/llm/openrouter";
import { GenerateRequestSchema } from "@/lib/llm/schemas";
import { errorResponse, classifyZodError } from "@/lib/api/errors";
import type { TablesInsert } from "@/db/database.types";

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

  // Deck-ownership check: RLS gates the cards-insert on user_id, but does NOT verify
  // that deck_id belongs to the caller. Without this SELECT (RLS-scoped to current user),
  // a session with any valid auth could insert cards into another user's deck by guessing
  // its uuid. 404 (not 403) avoids confirming existence to a scanner.
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

  const rows: TablesInsert<"cards">[] = generated.map((card) => ({
    user_id: user.id,
    deck_id,
    front: card.front,
    back: card.back,
  }));

  const { data: inserted, error } = await supabase.from("cards").insert(rows).select("id, front, back, created_at");

  if (error) {
    return errorResponse("DB_INSERT_FAILED");
  }

  return new Response(JSON.stringify({ ok: true, cards: inserted }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
