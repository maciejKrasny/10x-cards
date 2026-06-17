import type { SupabaseClient } from "@supabase/supabase-js";
import { fsrs, type Card } from "ts-fsrs";
import type { Database, Json, Tables } from "@/db/database.types";
import type { IntervalPreview, Rating, ReviewInput, ReviewResult, StudyCardView } from "./types";

type StudyClient = SupabaseClient<Database>;
type CardRow = Tables<"cards">;
type FsrsCardFields = Pick<
  CardRow,
  | "difficulty"
  | "due"
  | "elapsed_days"
  | "lapses"
  | "last_review"
  | "learning_steps"
  | "reps"
  | "scheduled_days"
  | "stability"
  | "state"
>;
type StudyCardRow = Pick<CardRow, "id" | "front" | "back"> & FsrsCardFields;

const scheduler = fsrs();

const RATING_ORDER: Rating[] = [1, 2, 3, 4];

export function cardRowToFsrs(row: FsrsCardFields): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

// The shape the record_review rpc expects as p_card_patch jsonb. Mirrors the
// 10 FSRS columns on cards.Row but with ISO strings for the two timestamps
// (which is how the rpc casts them back out of jsonb).
interface CardPatch {
  difficulty: number;
  due: string;
  elapsed_days: number;
  lapses: number;
  last_review: string;
  learning_steps: number;
  reps: number;
  scheduled_days: number;
  stability: number;
  state: number;
}

export function fsrsToCardPatch(card: Card): CardPatch {
  return {
    difficulty: card.difficulty,
    due: card.due.toISOString(),
    // ts-fsrs 5.x still emits elapsed_days on Card; removal is scheduled
    // for 6.0.0 — we persist it for now and migrate when we bump the lib.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by ts-fsrs 5.x Card shape
    elapsed_days: card.elapsed_days,
    lapses: card.lapses,
    // The rpc maps "" → null via nullif(...). A brand-new card written by the
    // service will always have a last_review (just set by scheduler.next).
    last_review: card.last_review ? card.last_review.toISOString() : "",
    learning_steps: card.learning_steps,
    reps: card.reps,
    scheduled_days: card.scheduled_days,
    stability: card.stability,
    state: card.state,
  };
}

export function previewIntervals(card: Card, now: Date): IntervalPreview[] {
  const preview = scheduler.repeat(card, now);
  return RATING_ORDER.map((rating) => {
    const next = preview[rating];
    return { rating, due: next.card.due.toISOString() };
  });
}

function rowToView(row: StudyCardRow, now: Date): StudyCardView {
  return {
    id: row.id,
    front: row.front,
    back: row.back,
    previews: previewIntervals(cardRowToFsrs(row), now),
  };
}

export async function getNextDueCard(
  supabase: StudyClient,
  _userId: string,
  deckId: string,
): Promise<StudyCardView | null> {
  // RLS gates on user_id = auth.uid(); the userId parameter is kept on the
  // signature to make the auth requirement explicit at call sites and to
  // give us a place to assert non-empty if we ever drop RLS in tests.
  const now = new Date();
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, front, back, difficulty, due, elapsed_days, lapses, last_review, learning_steps, reps, scheduled_days, stability, state",
    )
    .eq("deck_id", deckId)
    .lte("due", now.toISOString())
    .order("due", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("DB_QUERY_FAILED");
  if (!data) return null;
  return rowToView(data, now);
}

export async function applyRating(supabase: StudyClient, userId: string, input: ReviewInput): Promise<ReviewResult> {
  // 1. Load the card row (RLS confirms ownership; user_id field on cards
  //    table makes the deck-scoping for the next-card lookup implicit
  //    through the card's own deck_id).
  const { data: cardRow, error: cardError } = await supabase
    .from("cards")
    .select(
      "id, deck_id, user_id, front, back, difficulty, due, elapsed_days, lapses, last_review, learning_steps, reps, scheduled_days, stability, state",
    )
    .eq("id", input.card_id)
    .maybeSingle();
  if (cardError) throw new Error("DB_QUERY_FAILED");
  if (!cardRow) throw new Error("CARD_NOT_FOUND");
  if (cardRow.user_id !== userId) throw new Error("CARD_NOT_FOUND");

  // 2. Compute the FSRS next-state against the row's CURRENT state — never
  //    against a snapshot the client sent. The client never sends card state.
  const reviewAt = new Date(input.review_at);
  const { card: nextCard } = scheduler.next(cardRowToFsrs(cardRow), reviewAt, input.rating);
  const patch = fsrsToCardPatch(nextCard);

  // 3. Single-transaction insert log + advance card via the rpc. The rpc
  //    handles ON CONFLICT (card_id, review_at) by re-reading without
  //    re-applying the patch, so replays are idempotent. The conflicted
  //    bit tells the caller whether the write actually advanced the card
  //    so the UI can skip counter increments on replay.
  const { data: rpcData, error: rpcError } = await supabase.rpc("record_review", {
    p_card_id: input.card_id,
    p_rating: input.rating,
    p_review_at: input.review_at,
    p_card_patch: patch as unknown as Json,
  });
  if (rpcError) throw new Error("DB_UPDATE_FAILED");
  const conflicted = (rpcData as { conflicted?: boolean } | null)?.conflicted === true;

  // 4. Fetch the next due card for the same deck. We use the card's
  //    deck_id rather than asking the client — the client never sent
  //    deck_id with the rating, so it cannot ask to rate "for the wrong deck".
  const next = await getNextDueCard(supabase, userId, cardRow.deck_id);
  return { next, conflicted };
}
