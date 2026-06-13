import { z } from "zod";

// POST /api/study/review body. card_id is a UUID, rating one of the four
// non-Manual Grade values, and review_at an ISO-8601 string captured by the
// client at the moment of the rating click. review_at is the idempotency
// anchor — the server validates it sits within ±60s of `now()` before
// passing it through to the rpc, otherwise REVIEW_CONFLICT (409) bounces
// the client and the next click captures a fresh timestamp.

export const ReviewRequestSchema = z.object({
  card_id: z.uuid(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  review_at: z.iso.datetime(),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

const REVIEW_WINDOW_MS = 60_000;

export function withinReviewWindow(iso: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return false;
  return Math.abs(parsed - now.getTime()) <= REVIEW_WINDOW_MS;
}
