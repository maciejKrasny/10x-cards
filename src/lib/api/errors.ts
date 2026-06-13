import { z } from "zod";

// Shared error-envelope contract across every API route. Six near-identical copies
// of these constants is past the threshold where duplication starts to drift; one
// shared module keeps codes, English copy, and HTTP status aligned across the surface.
//
// Slightly wider than any single route needs — the trade-off is one place to edit
// when a new code appears anywhere.

export type ErrorCode =
  | "INVALID_REQUEST"
  | "INPUT_TOO_SHORT"
  | "INPUT_TOO_LONG"
  | "UNAUTHORIZED"
  | "DECK_NOT_FOUND"
  | "CARD_NOT_FOUND"
  | "REVIEW_CONFLICT"
  | "LLM_FAILURE"
  | "DB_INSERT_FAILED"
  | "DB_QUERY_FAILED"
  | "DB_UPDATE_FAILED"
  | "DB_DELETE_FAILED"
  | "SERVER_MISCONFIGURED";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: "Request body is invalid.",
  INPUT_TOO_SHORT: "Text is too short.",
  INPUT_TOO_LONG: "Text is too long.",
  UNAUTHORIZED: "Please sign in.",
  DECK_NOT_FOUND: "Deck not found.",
  CARD_NOT_FOUND: "Card not found.",
  REVIEW_CONFLICT: "Review timestamp is out of range. Please try again.",
  LLM_FAILURE: "Generation failed. Please try again.",
  DB_INSERT_FAILED: "Saving failed. Please try again.",
  DB_QUERY_FAILED: "Couldn't load data. Please try again.",
  DB_UPDATE_FAILED: "Updating failed. Please try again.",
  DB_DELETE_FAILED: "Deleting failed. Please try again.",
  SERVER_MISCONFIGURED: "Something went wrong. Please try again.",
};

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INPUT_TOO_SHORT: 400,
  INPUT_TOO_LONG: 400,
  UNAUTHORIZED: 401,
  DECK_NOT_FOUND: 404,
  CARD_NOT_FOUND: 404,
  REVIEW_CONFLICT: 409,
  LLM_FAILURE: 502,
  DB_INSERT_FAILED: 500,
  DB_QUERY_FAILED: 500,
  DB_UPDATE_FAILED: 500,
  DB_DELETE_FAILED: 500,
  SERVER_MISCONFIGURED: 500,
};

export function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message: ERROR_MESSAGES[code] } }), {
    status: STATUS_BY_CODE[code],
    headers: { "Content-Type": "application/json" },
  });
}

// Maps a Zod failure to the right INPUT_TOO_* code by inspecting the issue path
// + code. Used by every route that validates a body with `text`, `front`, or `back`
// length constraints.
export function classifyZodError(
  error: z.ZodError,
  fields: readonly string[] = ["text", "front", "back", "name"],
): ErrorCode {
  for (const issue of error.issues) {
    const head = issue.path[0];
    if (typeof head !== "string" || !fields.includes(head)) continue;
    if (issue.code === "too_big") return "INPUT_TOO_LONG";
    if (issue.code === "too_small") return "INPUT_TOO_SHORT";
  }
  return "INVALID_REQUEST";
}
