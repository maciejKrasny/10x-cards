import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { errorResponse, type ErrorCode } from "@/lib/api/errors";
import { getNextDueCard } from "@/lib/study/service";

export const prerender = false;

const DeckIdSchema = z.uuid();

export const GET: APIRoute = async (context) => {
  const rawDeckId = context.url.searchParams.get("deckId");
  const parsed = DeckIdSchema.safeParse(rawDeckId);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST");
  }
  const deckId = parsed.data;

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

  const { data: deck } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!deck) {
    return errorResponse("DECK_NOT_FOUND");
  }

  try {
    const card = await getNextDueCard(supabase, user.id, deckId);
    return new Response(JSON.stringify({ ok: true, card }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(serviceErrorToCode(err));
  }
};

function serviceErrorToCode(err: unknown): ErrorCode {
  const message = err instanceof Error ? err.message : "";
  if (message === "DB_QUERY_FAILED") return "DB_QUERY_FAILED";
  return "DB_QUERY_FAILED";
}
