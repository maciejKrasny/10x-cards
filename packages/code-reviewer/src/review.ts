import { generateText, NoObjectGeneratedError, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { buildPrompt, type PromptInput } from "./prompt.js";
import { computeVerdict, EXPECTED_CRITERIA_COUNT, reviewSchema, type Review, type Verdict } from "./schema.js";

const REQUEST_TIMEOUT_MS = 45_000;
const UPSTREAM_ERROR_TRUNCATION = 240;

export interface ReviewEnv {
  apiKey: string;
  model: string;
}

export interface ReviewResult extends Review {
  deterministicVerdict: Verdict;
}

export async function reviewPR(input: PromptInput, env: ReviewEnv): Promise<ReviewResult> {
  if (env.apiKey.length === 0) {
    throw new Error("LLM_NOT_CONFIGURED");
  }

  const { system, prompt } = buildPrompt(input);
  const provider = createOpenRouter({ apiKey: env.apiKey });
  const model = provider.chat(env.model);

  let object: Review;
  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: reviewSchema }),
      system,
      prompt,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    object = result.output;
  } catch (err) {
    throw mapError(err);
  }

  if (object.criteria.length !== EXPECTED_CRITERIA_COUNT) {
    throw new Error(
      `LLM_INVALID_OUTPUT: expected ${EXPECTED_CRITERIA_COUNT.toString()} criteria, got ${object.criteria.length.toString()}`,
    );
  }

  return { ...object, deterministicVerdict: computeVerdict(object.criteria) };
}

function mapError(err: unknown): Error {
  if (NoObjectGeneratedError.isInstance(err)) {
    return new Error("LLM_INVALID_OUTPUT");
  }
  const message = err instanceof Error ? err.message : String(err);
  const truncated = message.slice(0, UPSTREAM_ERROR_TRUNCATION);
  if (isEmptyResponseHint(message)) {
    return new Error(`LLM_EMPTY_RESPONSE: ${truncated}`);
  }
  return new Error(`LLM_HTTP_ERROR: ${truncated}`);
}

function isEmptyResponseHint(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("empty response") || m.includes("no content") || m.includes("no completion");
}
