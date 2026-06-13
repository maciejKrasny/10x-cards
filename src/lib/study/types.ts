// Study domain DTOs. Mirrors the LLM module's TS-only DTO layer
// (src/lib/llm/) so neither the API routes nor the React UI imports from
// `ts-fsrs` directly — the only module that may is service.ts.
//
// Rating is the integer the ts-fsrs Rating enum serializes to over JSON
// (1=Again, 2=Hard, 3=Good, 4=Easy). We narrow to a literal union so the
// shared schema/UI keeps it as a plain int without leaking the enum.

export type Rating = 1 | 2 | 3 | 4;

export interface IntervalPreview {
  rating: Rating;
  due: string;
}

export interface StudyCardView {
  id: string;
  front: string;
  back: string;
  previews: IntervalPreview[];
}

export interface ReviewInput {
  card_id: string;
  rating: Rating;
  review_at: string;
}

export interface ReviewResult {
  next: StudyCardView | null;
}
