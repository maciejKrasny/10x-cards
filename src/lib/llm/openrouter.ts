import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";
import { GeneratedCardsSchema, type GeneratedCard } from "./schemas";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = [
  "You generate flashcards from a user-provided passage.",
  "Detect the language of the passage and produce all front/back text in that same language.",
  "Each card must have a concise question or prompt on `front` and the precise answer on `back`.",
  "Return between 1 and 30 cards. Prefer fewer high-quality cards over many low-quality ones.",
  "Do not include any commentary, citations, or markdown — only the structured JSON object the schema requires.",
].join(" ");

const CARDS_JSON_SCHEMA = {
  name: "cards",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["front", "back"],
          properties: {
            front: { type: "string", minLength: 1, maxLength: 1000 },
            back: { type: "string", minLength: 1, maxLength: 1000 },
          },
        },
      },
    },
  },
} as const;

export async function generateCardsFromText(text: string): Promise<GeneratedCard[]> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("LLM_NOT_CONFIGURED");
  }

  const model = OPENROUTER_MODEL ?? DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: CARDS_JSON_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("LLM_HTTP_ERROR");
  }

  if (!response.ok) {
    throw new Error("LLM_HTTP_ERROR");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("LLM_INVALID_OUTPUT");
  }

  const content = extractAssistantContent(payload);
  if (!content) {
    throw new Error("LLM_EMPTY_RESPONSE");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("LLM_INVALID_OUTPUT");
  }

  const cardsField = (parsed as { cards?: unknown }).cards;
  const validation = GeneratedCardsSchema.safeParse(cardsField);
  if (!validation.success) {
    throw new Error("LLM_INVALID_OUTPUT");
  }

  return validation.data;
}

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.length > 0 ? content : null;
}
