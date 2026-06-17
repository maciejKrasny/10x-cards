import { z } from "zod";

// Bounds match the `front` / `back` CHECK constraints on the cards table
// (char_length between 1 and 1000). This duplicates the bounds in
// src/lib/llm/schemas.ts's GeneratedCardSchema by design — the LLM schema
// is shipped to OpenRouter as a response_format and may evolve differently;
// this is the API-input schema for HTTP routes. Both must stay aligned with
// the cards table.

export const CardBodySchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
});

export type CardBody = z.infer<typeof CardBodySchema>;

// Bulk insert: caps the batch at 30 to match GeneratedCardsSchema (the LLM
// is the only producer today). If a manual bulk path appears later, revisit.
export const BulkCreateRequestSchema = z.object({
  deck_id: z.uuid(),
  cards: z.array(CardBodySchema).min(1).max(30),
});

export type BulkCreateRequest = z.infer<typeof BulkCreateRequestSchema>;
