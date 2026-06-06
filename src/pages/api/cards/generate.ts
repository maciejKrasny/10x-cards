import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { generateCardsFromText } from "@/lib/llm/openrouter";
import { GenerateRequestSchema } from "@/lib/llm/schemas";
import type { TablesInsert } from "@/db/database.types";

export const prerender = false;

type ErrorCode =
  | "INVALID_REQUEST"
  | "INPUT_TOO_SHORT"
  | "INPUT_TOO_LONG"
  | "UNAUTHORIZED"
  | "LLM_FAILURE"
  | "DB_INSERT_FAILED"
  | "SERVER_MISCONFIGURED";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: "Request body is invalid.",
  INPUT_TOO_SHORT: "Text is empty. Please paste at least 1 character.",
  INPUT_TOO_LONG: "Text exceeds 6000 characters. Please shorten it.",
  UNAUTHORIZED: "Please sign in to generate cards.",
  LLM_FAILURE: "Generation failed. Please try again.",
  DB_INSERT_FAILED: "Saving failed. Please try again.",
  SERVER_MISCONFIGURED: "Something went wrong. Please try again.",
};

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INPUT_TOO_SHORT: 400,
  INPUT_TOO_LONG: 400,
  UNAUTHORIZED: 401,
  LLM_FAILURE: 502,
  DB_INSERT_FAILED: 500,
  SERVER_MISCONFIGURED: 500,
};

function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message: ERROR_MESSAGES[code] } }), {
    status: STATUS_BY_CODE[code],
    headers: { "Content-Type": "application/json" },
  });
}

function classifyZodError(error: z.ZodError): ErrorCode {
  for (const issue of error.issues) {
    if (issue.path[0] !== "text") continue;
    if (issue.code === "too_big") return "INPUT_TOO_LONG";
    if (issue.code === "too_small") return "INPUT_TOO_SHORT";
  }
  return "INVALID_REQUEST";
}

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("INVALID_REQUEST");
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(classifyZodError(parsed.error));
  }
  const { text } = parsed.data;

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

  let generated;
  try {
    generated = await generateCardsFromText(text);
  } catch {
    return errorResponse("LLM_FAILURE");
  }

  const rows: TablesInsert<"cards">[] = generated.map((card) => ({
    user_id: user.id,
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
