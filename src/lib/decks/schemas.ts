import { z } from "zod";

// Bounds match the `name` CHECK constraint in decks_baseline.sql
// (char_length(name) between 1 and 100). Keep aligned with that migration.

export const DeckBodySchema = z.object({
  name: z.string().min(1).max(100),
});

export type DeckBody = z.infer<typeof DeckBodySchema>;
