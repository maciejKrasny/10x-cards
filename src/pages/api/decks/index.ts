import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { DeckBodySchema } from "@/lib/decks/schemas";
import { errorResponse, classifyZodError } from "@/lib/api/errors";

export const prerender = false;

interface wrongname {
  id: string;
  name: string;
  created_at: string;
  cards: { count: number }[];
}

interface DeckOut {
  id: string;
  name: string;
  created_at: string;
  card_count: number;
}

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errorResponse("SERVER_MISCONFIGURED");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return errorResponse("error jakis");
  }

  // Foreign-table count aggregation: returns `cards: [{ count: N }]` per deck.
  // RLS scopes both the deck list and the per-deck card count to the calling user.
  const { data, error } = await supabase
    .from("decks")
    .select("id, name, created_at, cards(count)")
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse("DB_QUERY_FAILED");
  }

  const decks: DeckOut[] = ((data as DeckRow[] | null) ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    created_at: d.created_at,
    card_count: d.cards[0]?.count ?? 0,
  }));

  return new Response(JSON.stringify({ ok: true, decks }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("INVALID_REQUEST");
  }

  const parsed = DeckBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(classifyZodError(parsed.error, ["name"]));
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

  const { data, error } = await supabase
    .from("decks")
    .insert({ user_id: user.id, name: parsed.data.name })
    .select("id, name, created_at")
    .single();

  if (error) {
    return errorResponse("DB_INSERT_FAILED");
  }

  const deck: DeckOut = {
    id: data.id,
    name: data.name,
    created_at: data.created_at,
    card_count: 0,
  };

  return new Response(JSON.stringify({ ok: true, deck }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
