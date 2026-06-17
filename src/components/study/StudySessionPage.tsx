import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeShort } from "@/lib/study/format";
import type { Rating, StudyCardView } from "@/lib/study/types";

type NextResponse = { ok: true; card: StudyCardView | null } | { ok: false; error: { code: string; message: string } };

type ReviewResponse =
  | { ok: true; next: StudyCardView | null; done: boolean; conflicted: boolean }
  | { ok: false; error: { code: string; message: string } };

interface Counters {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

type Phase = "loading" | "showFront" | "showAnswer" | "submitting" | "summary" | "fatal";

const RATING_LABELS: Record<Rating, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

const RATING_CLASSES: Record<Rating, string> = {
  1: "border-red-400/70 bg-red-500/25 text-red-50 hover:border-red-300 hover:bg-red-500/40",
  2: "border-amber-400/70 bg-amber-500/25 text-amber-50 hover:border-amber-300 hover:bg-amber-500/40",
  3: "border-emerald-400/70 bg-emerald-500/25 text-emerald-50 hover:border-emerald-300 hover:bg-emerald-500/40",
  4: "border-sky-400/70 bg-sky-500/25 text-sky-50 hover:border-sky-300 hover:bg-sky-500/40",
};

const RATING_DOT_CLASSES: Record<Rating, string> = {
  1: "bg-red-400",
  2: "bg-amber-400",
  3: "bg-emerald-400",
  4: "bg-sky-400",
};

const RATING_KEYS: Partial<Record<string, Rating>> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Please sign in to study.",
  DECK_NOT_FOUND: "Deck not found.",
  CARD_NOT_FOUND: "This card no longer exists.",
  REVIEW_CONFLICT: "Network hiccup. Please try again.",
  DB_QUERY_FAILED: "Couldn't load the next card. Please try again.",
  DB_UPDATE_FAILED: "Couldn't save your rating. Please try again.",
  INVALID_REQUEST: "Something went wrong. Please try again.",
};

function messageFor(code: string | undefined): string {
  if (!code) return ERROR_MESSAGES.INVALID_REQUEST;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INVALID_REQUEST;
}

export default function StudySessionPage({ deckId }: { deckId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [card, setCard] = useState<StudyCardView | null>(null);
  const [counters, setCounters] = useState<Counters>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingReviewAt, setPendingReviewAt] = useState<string | null>(null);

  useEffect(() => {
    const state: { cancelled: boolean } = { cancelled: false };
    void (async () => {
      try {
        const res = await fetch(`/api/study/next?deckId=${encodeURIComponent(deckId)}`);
        const body = (await res.json()) as NextResponse;
        if (state.cancelled) return;
        if (!res.ok || !body.ok) {
          setErrorMessage(messageFor(!body.ok ? body.error.code : undefined));
          setPhase("fatal");
          return;
        }
        if (body.card === null) {
          setCard(null);
          setPhase("summary");
          return;
        }
        setCard(body.card);
        setPhase("showFront");
      } catch {
        if (state.cancelled) return;
        setErrorMessage(ERROR_MESSAGES.DB_QUERY_FAILED);
        setPhase("fatal");
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [deckId]);

  const reveal = useCallback(() => {
    setPhase((current) => (current === "showFront" ? "showAnswer" : current));
  }, []);

  const submit = useCallback(
    async (rating: Rating) => {
      if (!card) return;
      if (phase === "submitting") return;
      const reviewAt = pendingReviewAt ?? new Date().toISOString();
      setPendingReviewAt(reviewAt);
      setPhase("submitting");
      setErrorMessage(null);
      try {
        const res = await fetch("/api/study/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card_id: card.id, rating, review_at: reviewAt }),
        });
        const body = (await res.json()) as ReviewResponse;
        if (!res.ok || !body.ok) {
          const code = !body.ok ? body.error.code : undefined;
          if (code === "REVIEW_CONFLICT") {
            setPendingReviewAt(null);
          }
          if (code === "CARD_NOT_FOUND") {
            setErrorMessage(messageFor(code));
            setPhase("fatal");
            window.setTimeout(() => {
              window.location.assign(`/decks/${deckId}`);
            }, 1500);
            return;
          }
          setErrorMessage(messageFor(code));
          setPhase("showAnswer");
          return;
        }
        // Skip the counter tick on rpc-level replay: the rpc dedupes by
        // (card_id, review_at) and surfaces `conflicted` so we don't
        // double-count a logically-single review across retries or stale tabs.
        if (!body.conflicted) {
          setCounters((prev) => {
            const next = { ...prev };
            if (rating === 1) next.again += 1;
            else if (rating === 2) next.hard += 1;
            else if (rating === 3) next.good += 1;
            else next.easy += 1;
            return next;
          });
        }
        setPendingReviewAt(null);
        if (body.done || body.next === null) {
          setCard(null);
          setPhase("summary");
        } else {
          setCard(body.next);
          setPhase("showFront");
        }
      } catch {
        setErrorMessage(ERROR_MESSAGES.DB_UPDATE_FAILED);
        setPhase("showAnswer");
      }
    },
    [card, deckId, pendingReviewAt, phase],
  );

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (phase === "showFront" && event.code === "Space") {
        event.preventDefault();
        reveal();
        return;
      }
      if (phase === "showAnswer") {
        const rating = RATING_KEYS[event.key];
        if (rating) {
          event.preventDefault();
          void submit(rating);
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [phase, reveal, submit]);

  if (phase === "loading") {
    return <p className="text-white/80">Loading…</p>;
  }

  if (phase === "fatal") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>{errorMessage ?? ERROR_MESSAGES.INVALID_REQUEST}</AlertDescription>
      </Alert>
    );
  }

  if (phase === "summary") {
    const total = counters.again + counters.hard + counters.good + counters.easy;
    return (
      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle>{total === 0 ? "Nothing due right now" : `Reviewed ${total} cards`}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {total > 0 ? (
            <ul className="space-y-1 text-sm text-white/80">
              <li>Again: {counters.again}</li>
              <li>Hard: {counters.hard}</li>
              <li>Good: {counters.good}</li>
              <li>Easy: {counters.easy}</li>
            </ul>
          ) : null}
          <p className="text-sm text-white/60">Come back tomorrow.</p>
        </CardContent>
        <CardFooter>
          <a className="text-sky-300 hover:underline" href={`/decks/${deckId}`}>
            ← Back to deck
          </a>
        </CardFooter>
      </Card>
    );
  }

  if (!card) return null;

  const previewByRating = new Map<Rating, string>(card.previews.map((p) => [p.rating, p.due]));
  const submitting = phase === "submitting";

  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle className="text-sm font-medium tracking-wide text-white/60 uppercase">Front</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl">{card.front}</p>
          {phase !== "showFront" ? (
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="text-sm font-medium tracking-wide text-white/60 uppercase">Back</p>
              <p className="mt-2 text-xl">{card.back}</p>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          {phase === "showFront" ? (
            <Button
              onClick={reveal}
              className="border border-purple-400/60 bg-purple-500/30 font-medium text-white backdrop-blur-sm hover:border-purple-300 hover:bg-purple-500/45"
            >
              Show answer (Space)
            </Button>
          ) : (
            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
              {([1, 2, 3, 4] as const).map((rating) => (
                <Button
                  key={rating}
                  onClick={() => void submit(rating)}
                  disabled={submitting}
                  className={`h-auto flex-col items-start gap-1 rounded-xl border px-3 py-2.5 backdrop-blur-sm transition-colors disabled:opacity-60 ${RATING_CLASSES[rating]}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${RATING_DOT_CLASSES[rating]}`} />
                    <span className="opacity-80">{rating}.</span>
                    {RATING_LABELS[rating]}
                  </span>
                  <span className="text-xs text-white/75">{relativeShort(previewByRating.get(rating) ?? "")}</span>
                </Button>
              ))}
            </div>
          )}
        </CardFooter>
      </Card>
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
