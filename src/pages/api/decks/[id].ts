import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { DeckBodySchema } from "@/lib/decks/schemas";
import { errorResponse, classifyZodError } from "@/lib/api/errors";

export const prerender = false;

export const PATCH: APIRoute = async (context) => {
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

  // Defence-in-depth: RLS already gates ownership, but the explicit user_id
  // predicate documents the intent and protects against a future RLS edit.
  const { data, error } = await supabase
    .from("decks")
    .update({ name: parsed.data.name })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, created_at")
    .maybeSingle();

  if (error) {
    return errorResponse("DB_UPDATE_FAILED");
  }
  if (!data) {
    return errorResponse("DECK_NOT_FOUND");
  }

  return new Response(JSON.stringify({ ok: true, deck: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const DELETE: APIRoute = async (context) => {
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

  const { data, error } = await supabase
    .from("decks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return errorResponse("DB_DELETE_FAILED");
  }
  if (!data) {
    return errorResponse("DECK_NOT_FOUND");
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
