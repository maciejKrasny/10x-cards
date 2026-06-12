import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { CardBodySchema } from "@/lib/cards/schemas";
import { errorResponse, classifyZodError } from "@/lib/api/errors";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const id = context.params.id;
  if (typeof id !== "string") {
    return errorResponse("INVALID_REQUEST");
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

  // Verify deck ownership AND fetch the name in one round-trip; the deck-detail
  // page renders the heading from this same payload, no second query.
  const { data: deck } = await supabase
    .from("decks")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!deck) {
    return errorResponse("DECK_NOT_FOUND");
  }

  // 500 cap is policy not protection; the UI displays a banner when hit.
  const { data: cards, error } = await supabase
    .from("cards")
    .select("id, front, back, created_at")
    .eq("deck_id", id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return errorResponse("DB_QUERY_FAILED");
  }

  return new Response(JSON.stringify({ ok: true, deck, cards }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: APIRoute = async (context) => {
  const id = context.params.id;
  if (typeof id !== "string") {
    return errorResponse("INVALID_REQUEST");
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("INVALID_REQUEST");
  }

  const parsed = CardBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(classifyZodError(parsed.error, ["front", "back"]));
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

  // Security-critical ownership check: RLS on cards-insert only validates user_id,
  // not deck_id. Without this SELECT (RLS-scoped to current user), a session
  // could insert into another user's deck by guessing its uuid.
  const { data: deck } = await supabase.from("decks").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!deck) {
    return errorResponse("DECK_NOT_FOUND");
  }

  const { data, error } = await supabase
    .from("cards")
    .insert({
      user_id: user.id,
      deck_id: id,
      front: parsed.data.front,
      back: parsed.data.back,
    })
    .select("id, front, back, created_at")
    .single();

  if (error) {
    return errorResponse("DB_INSERT_FAILED");
  }

  return new Response(JSON.stringify({ ok: true, card: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
