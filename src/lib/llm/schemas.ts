import { z } from "zod";

export const GenerateRequestSchema = z.object({
  text: z.string().min(1).max(6000),
});

export const GeneratedCardSchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
});

export const GeneratedCardsSchema = z.array(GeneratedCardSchema).min(1).max(30);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type GeneratedCard = z.infer<typeof GeneratedCardSchema>;
export type GeneratedCards = z.infer<typeof GeneratedCardsSchema>;
