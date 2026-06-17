import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { BulkCreateRequestSchema } from "@/lib/cards/schemas";
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

  const parsed = BulkCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(classifyZodError(parsed.error, ["front", "back"]));
  }
  const { deck_id, cards } = parsed.data;

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

  // Deck-ownership check (same scanner-confirmation risk as generate.ts):
  // RLS on cards-insert only validates user_id, not deck_id. 404 (not 403)
  // avoids confirming existence to a scanner.
  const { data: deck } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deck_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!deck) {
    return errorResponse("DECK_NOT_FOUND");
  }

  // Single-statement multi-row INSERT is atomic in Postgres — all rows commit
  // or none do, satisfying the all-or-nothing transaction requirement.
  const rows: TablesInsert<"cards">[] = cards.map((card) => ({
    user_id: user.id,
    deck_id,
    front: card.front,
    back: card.back,
  }));

  const { data: inserted, error } = await supabase.from("cards").insert(rows).select("id, front, back, created_at");

  if (error) {
    return errorResponse("DB_INSERT_FAILED");
  }

  return new Response(JSON.stringify({ ok: true, deck_id, cards: inserted }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
